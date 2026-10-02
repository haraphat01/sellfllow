import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { dispatchPaymentSucceeded, dispatchUnpayableOrder } from "@/jobs/events";
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

  if (result.paid) dispatchPaymentSucceeded(result.paid);
  if (result.unpayable) dispatchUnpayableOrder(result.unpayable);

  return NextResponse.json({ received: result.status === 200 }, { status: result.status });
}
