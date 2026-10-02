import "server-only";

import { logger, type Logger } from "@/lib/observability/logger";
import type { DbClient } from "@/lib/supabase/types";
import type { Json } from "@/db/types/database";
import { nextMessageStatus, type InboundMessageEvent, type StatusEvent, type WhatsAppEvent } from "@/lib/whatsapp/webhook";

import { ensureOpenConversation, preview, upsertCustomer } from "./conversations.repo";

/**
 * Inbound pipeline:
 *   1. recordWebhookEvents  — inside the webhook request: route each event to a
 *      business by phone_number_id and persist it idempotently. Fast.
 *   2. processWhatsAppEvent — in a background job: customer, conversation,
 *      message, statuses. Safe to retry.
 */

export type QueuedEvent = { id: string; businessId: string; concurrencyKey: string };

type AccountRef = { id: string; business_id: string; status: string };

export async function recordWebhookEvents(admin: DbClient, events: WhatsAppEvent[], requestId: string): Promise<QueuedEvent[]> {
  if (!events.length) return [];

  // Tenant routing: phone_number_id -> whatsapp_accounts -> business_id. Never from message content.
  const phoneIds = Array.from(new Set(events.map((e) => e.phoneNumberId)));
  const { data: accounts, error: accountsError } = await admin
    .from("whatsapp_accounts")
    .select("id, business_id, status, phone_number_id")
    .in("phone_number_id", phoneIds);
  if (accountsError) throw accountsError;
  const byPhone = new Map<string, AccountRef>((accounts ?? []).map((a) => [a.phone_number_id, a]));

  const rows = events.map((e) => {
    const account = byPhone.get(e.phoneNumberId);
    const routable = account && account.status !== "disconnected";
    return {
      event_key: e.eventKey,
      event_type: e.kind,
      phone_number_id: e.phoneNumberId,
      business_id: routable ? account.business_id : null,
      whatsapp_account_id: routable ? account.id : null,
      // Dates are serialised as `time`; restored when processing.
      payload: JSON.parse(JSON.stringify({ ...e, sentAt: undefined, at: undefined, time: (e.kind === "message" ? e.sentAt : e.at).toISOString() })) as Json,
      status: routable ? ("received" as const) : ("ignored" as const),
      error: routable ? null : "no connected whatsapp account for phone_number_id",
      request_id: requestId,
    };
  });

  // Duplicate deliveries collide on event_key and are skipped.
  const { error } = await admin.from("whatsapp_events").upsert(rows, { onConflict: "event_key", ignoreDuplicates: true });
  if (error) throw error;

  // Enqueue anything not yet processed — including earlier deliveries whose
  // enqueue failed (Meta retried because we returned non-2xx).
  const { data: pending, error: pendingError } = await admin
    .from("whatsapp_events")
    .select("id, business_id, payload, event_type")
    .in("event_key", rows.map((r) => r.event_key))
    .in("status", ["received", "failed"]);
  if (pendingError) throw pendingError;

  return (pending ?? []).filter((p) => p.business_id).map(toQueuedEvent);
}

function toQueuedEvent(p: { id: string; business_id: string | null; payload: Json; event_type: string }): QueuedEvent {
  const payload = p.payload as { from?: string; waMessageId?: string };
  return {
    id: p.id,
    businessId: p.business_id as string,
    // Messages from one customer are processed in order; statuses by message.
    concurrencyKey: `${p.business_id}:${p.event_type === "message" ? payload.from : payload.waMessageId}`,
  };
}

const STUCK_AFTER_MS = 15 * 60_000;
const RETRY_AFTER_MS = 2 * 60_000;
const SWEEP_HORIZON_MS = 24 * 60 * 60_000;

/**
 * Safety net for events whose background processing never finished: the
 * Inngest send failed, every retry failed, or a worker died mid-run.
 * Returns the events to enqueue again (processing is idempotent).
 */
export async function findEventsToRetry(admin: DbClient, now = new Date(), limit = 200): Promise<QueuedEvent[]> {
  const iso = (ms: number) => new Date(now.getTime() - ms).toISOString();

  // A worker that died leaves the event "processing" forever.
  const { error: resetError } = await admin
    .from("whatsapp_events")
    .update({ status: "failed", error: "processing timed out" })
    .eq("status", "processing")
    .lt("received_at", iso(STUCK_AFTER_MS))
    .gt("received_at", iso(SWEEP_HORIZON_MS));
  if (resetError) throw resetError;

  const { data, error } = await admin
    .from("whatsapp_events")
    .select("id, business_id, payload, event_type")
    .in("status", ["received", "failed"])
    .not("business_id", "is", null)
    .lt("attempts", MAX_ATTEMPTS)
    .lt("received_at", iso(RETRY_AFTER_MS))
    .gt("received_at", iso(SWEEP_HORIZON_MS))
    .order("received_at")
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(toQueuedEvent);
}

// Exact-match keywords (after trimming punctuation), as WhatsApp users expect.
const OPT_OUT = /^(stop|stop all|unsubscribe|opt ?-?out|cancel messages)$/i;
const OPT_IN = /^(start|unstop|subscribe|opt ?-?in)$/i;

export function optKeyword(body: string | null): "opt_out" | "opt_in" | null {
  const t = (body ?? "").trim().replace(/[.!\s]+$/g, "");
  if (OPT_OUT.test(t)) return "opt_out";
  if (OPT_IN.test(t)) return "opt_in";
  return null;
}

export type ProcessResult =
  | { outcome: "skipped"; reason: string }
  | { outcome: "message"; businessId: string; conversationId: string; messageId: string; aiMode: string; optChange: "opt_out" | "opt_in" | null; isOptKeyword: boolean }
  | { outcome: "status"; updated: boolean };

const MAX_ATTEMPTS = 8;

export async function processWhatsAppEvent(admin: DbClient, eventId: string): Promise<ProcessResult> {
  // Claim the event atomically so two workers can never process it twice.
  const { data: claimed, error: claimError } = await admin
    .from("whatsapp_events")
    .update({ status: "processing" })
    .eq("id", eventId)
    .in("status", ["received", "failed"])
    .select("id, business_id, whatsapp_account_id, event_type, payload, attempts")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return { outcome: "skipped", reason: "already processed or in progress" };
  if (!claimed.business_id || !claimed.whatsapp_account_id) {
    await admin.from("whatsapp_events").update({ status: "ignored", processed_at: new Date().toISOString() }).eq("id", eventId);
    return { outcome: "skipped", reason: "unroutable" };
  }

  const log = logger.child({ webhook_event_id: eventId, business_id: claimed.business_id, whatsapp_account_id: claimed.whatsapp_account_id });
  const attempts = (claimed.attempts ?? 0) + 1;

  try {
    const payload = claimed.payload as Record<string, unknown> & { time: string };
    const result =
      claimed.event_type === "message"
        ? await handleMessage(admin, log, claimed.business_id, claimed.whatsapp_account_id, {
            ...(payload as unknown as InboundMessageEvent),
            sentAt: new Date(payload.time),
          })
        : await handleStatus(admin, log, claimed.business_id, { ...(payload as unknown as StatusEvent), at: new Date(payload.time) });

    await admin.from("whatsapp_events").update({ status: "processed", attempts, error: null, processed_at: new Date().toISOString() }).eq("id", eventId);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : String(err);
    await admin
      .from("whatsapp_events")
      .update({ status: attempts >= MAX_ATTEMPTS ? "ignored" : "failed", attempts, error: message.slice(0, 1000) })
      .eq("id", eventId);
    log.error("whatsapp.event.failed", err, { attempts });
    throw err;
  }
}

async function handleMessage(
  admin: DbClient,
  log: Logger,
  businessId: string,
  accountId: string,
  e: InboundMessageEvent,
): Promise<ProcessResult> {
  const customer = await upsertCustomer(admin, { businessId, waId: e.from, profileName: e.profileName, interactionAt: e.sentAt });
  const conversation = await ensureOpenConversation(admin, { businessId, customerId: customer.id, whatsappAccountId: accountId });

  const { data: inserted, error } = await admin
    .from("messages")
    .upsert(
      {
        business_id: businessId,
        conversation_id: conversation.id,
        direction: "inbound",
        sender: "customer",
        type: e.type,
        body: e.body,
        content: { raw: e.raw, reply_to: e.replyToWaMessageId } as never,
        wa_message_id: e.waMessageId,
        status: "received",
        created_at: e.sentAt.toISOString(),
      },
      { onConflict: "wa_message_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw error;

  const messageId = inserted?.[0]?.id;
  if (!messageId) {
    // Same Meta message already stored (e.g. re-processed after a partial failure).
    const { data: prior } = await admin.from("messages").select("id").eq("wa_message_id", e.waMessageId).single();
    log.info("whatsapp.message.duplicate", { message_id: prior?.id });
    return { outcome: "skipped", reason: "duplicate message" };
  }

  await admin
    .from("conversations")
    .update({
      last_message_at: e.sentAt.toISOString(),
      last_customer_message_at: e.sentAt.toISOString(),
      last_message_preview: preview(e.body, e.type),
      unread_count: conversation.unread_count + 1,
    })
    .eq("business_id", businessId)
    .eq("id", conversation.id);

  await admin.rpc("record_usage", { p_business_id: businessId, p_metric: "messages", p_quantity: 1 });

  // STOP / START: consent for unsolicited messages (follow-ups, campaigns).
  const keyword = e.type === "text" ? optKeyword(e.body) : null;
  const optChange = keyword === "opt_out" ? (customer.opted_out_at ? null : "opt_out") : keyword === "opt_in" && customer.opted_out_at ? "opt_in" : null;
  if (optChange) {
    await admin
      .from("customers")
      .update({ opted_out_at: optChange === "opt_out" ? e.sentAt.toISOString() : null })
      .eq("business_id", businessId)
      .eq("id", customer.id);
    if (optChange === "opt_out") {
      await admin
        .from("follow_ups")
        .update({ status: "cancelled", cancel_reason: "opted_out" })
        .eq("business_id", businessId)
        .eq("customer_id", customer.id)
        .eq("status", "scheduled");
    }
    await admin.from("conversation_events").insert({
      business_id: businessId,
      conversation_id: conversation.id,
      type: optChange === "opt_out" ? "customer_opted_out" : "customer_opted_in",
      actor_type: "system",
      data: { message_id: messageId },
    });
    log.info(`customer.${optChange}`, { conversation_id: conversation.id, customer_id: customer.id });
  }

  log.info("whatsapp.message.stored", { conversation_id: conversation.id, message_id: messageId, type: e.type });
  return {
    outcome: "message",
    businessId,
    conversationId: conversation.id,
    messageId,
    aiMode: conversation.ai_mode,
    optChange,
    // STOP (even repeated) and a START that changed consent are handled here, not by the AI.
    isOptKeyword: keyword === "opt_out" || optChange !== null,
  };
}

async function handleStatus(admin: DbClient, log: Logger, businessId: string, e: StatusEvent): Promise<ProcessResult> {
  if (e.status === "deleted") return { outcome: "status", updated: false };

  const { data: message } = await admin
    .from("messages")
    .select("id, status")
    .eq("business_id", businessId)
    .eq("wa_message_id", e.waMessageId)
    .maybeSingle();
  if (!message) {
    log.info("whatsapp.status.unknown_message", { wa_message_id: e.waMessageId, status: e.status });
    return { outcome: "status", updated: false };
  }

  const next = nextMessageStatus(message.status, e.status);
  if (!next) return { outcome: "status", updated: false };

  // Conditional on the status we read, so an out-of-order concurrent update can't regress it.
  const { data } = await admin
    .from("messages")
    .update({ status: next as never, error: e.status === "failed" ? e.error : null })
    .eq("id", message.id)
    .eq("status", message.status)
    .select("id");
  return { outcome: "status", updated: Boolean(data?.length) };
}
