import type { NextRequest } from "next/server";

import { handlePaystackRequest } from "./handler";

/**
 * Paystack webhook. Same handler as /api/webhooks/paystack/billing: order
 * payments (bank payouts, and legacy merchant-key payments made before bank
 * payouts replaced them) and subscription payments. See ./handler.ts.
 */
export function POST(request: NextRequest) {
  return handlePaystackRequest(request);
}
