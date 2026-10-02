import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { serverEnv } from "@/lib/env/server";
import { EVENTS, inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyMetaSignature } from "@/lib/whatsapp/signature";
import { extractEvents } from "@/lib/whatsapp/webhook";
import { recordWebhookEvents } from "@/services/whatsapp/inbound.service";

const MAX_BODY_BYTES = 1_000_000;

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Meta webhook verification handshake. */
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const expected = serverEnv().META_VERIFY_TOKEN;
  if (
    expected &&
    params.get("hub.mode") === "subscribe" &&
    safeEqual(params.get("hub.verify_token") ?? "", expected) &&
    params.get("hub.challenge")
  ) {
    return new Response(params.get("hub.challenge"), { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * Inbound messages and statuses. Verifies the signature, stores events
 * idempotently, enqueues processing, and returns quickly. Never does AI or
 * outbound work in the request.
 */
export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const log = logger.child({ request_id: requestId, route: "webhooks.whatsapp" });

  const appSecret = serverEnv().META_APP_SECRET;
  if (!appSecret) {
    log.error("whatsapp.webhook.not_configured");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return NextResponse.json({ error: "payload too large" }, { status: 413 });

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "payload too large" }, { status: 413 });

  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), appSecret)) {
    log.warn("whatsapp.webhook.bad_signature");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { events, skipped, fields } = extractEvents(payload);
  if (skipped) log.warn("whatsapp.webhook.skipped_items", { skipped });
  if (!events.length) {
    log.info("whatsapp.webhook.no_events", { fields });
    return NextResponse.json({ received: true });
  }

  try {
    const queued = await recordWebhookEvents(createAdminClient(), events, requestId);
    if (queued.length) {
      await inngest.send(
        queued.map((q) => ({
          name: EVENTS.whatsappEventReceived,
          id: `whatsapp-event-${q.id}`, // Inngest-side dedupe for retried deliveries
          data: { eventId: q.id, businessId: q.businessId, concurrencyKey: q.concurrencyKey },
        })),
      );
    }
    log.info("whatsapp.webhook.accepted", { events: events.length, queued: queued.length });
    return NextResponse.json({ received: true });
  } catch (err) {
    // Non-2xx makes Meta retry; stored events are re-enqueued idempotently.
    log.error("whatsapp.webhook.failed", err, { events: events.length });
    return NextResponse.json({ error: "temporarily unavailable" }, { status: 500 });
  }
}
