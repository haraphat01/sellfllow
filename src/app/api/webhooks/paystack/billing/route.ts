import type { NextRequest } from "next/server";

import { handlePaystackRequest } from "../handler";

/**
 * Webhook for SellFlow's own Paystack account (PAYSTACK_SECRET_KEY). That
 * account sends everything to one URL: subscription payments (`sfb-…`) and
 * order payments split to merchants' bank-account subaccounts. Both are
 * handled here, signed with the platform key. See ../handler.ts.
 */
export function POST(request: NextRequest) {
  return handlePaystackRequest(request);
}
