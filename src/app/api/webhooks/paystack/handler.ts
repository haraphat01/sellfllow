import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { EVENTS, inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { handlePaystackWebhook } from "@/services/payments/payments.service";

const MAX_BODY_BYTES = 500_000;

/**
 * Shared by both Paystack webhook URLs. Events are routed by reference:
 * `sfb-…` → SellFlow subscription billing; anything else → an order payment,
 * verified with the key that created it (SellFlow's platform key for bank
 * payouts, or the merchant's key for legacy payments made before bank payouts).
 * Charges are always re-verified with Paystack before anything is marked paid.
 */
export async function handlePaystackRequest(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "payload too large" }, { status: 413 });

  const result = await handlePaystackWebhook(createAdminClient(), {
    rawBody: raw,
    signature: request.headers.get("x-paystack-signature"),
    requestId,
  });

  try {
    if (result.paid) {
      await inngest.send({ name: EVENTS.paymentSucceeded, id: `payment-succeeded-${result.paid.orderId}`, data: result.paid });
    }
    if (result.unpayable) {
      await inngest.send({ name: EVENTS.paymentForUnpayableOrder, id: `payment-unpayable-${result.unpayable.orderId}`, data: result.unpayable });
    }
  } catch (err) {
    // The payment is already recorded; the notification can be re-sent by a later confirm.
    logger.error("paystack.webhook.enqueue_failed", err, { request_id: requestId });
  }

  return NextResponse.json({ received: result.status === 200 }, { status: result.status });
}
