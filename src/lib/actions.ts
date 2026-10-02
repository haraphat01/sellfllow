import "server-only";

import { AuthorizationError } from "@/lib/auth/errors";
import { logger } from "@/lib/observability/logger";
import { PlanLimitError } from "@/services/billing/limits";
import { ProductError } from "@/services/products/products.service";
import { TeamError } from "@/services/team/team.service";
import { ConversationError } from "@/services/conversations/conversations.service";
import { CustomerError } from "@/services/customers/customers.service";
import { OutboundMessageError } from "@/services/whatsapp/outbound.service";
import { OrderError } from "@/services/orders/orders.service";
import { PaymentError } from "@/services/payments/payments.service";
import { BillingError } from "@/services/billing/billing.service";
import { AdminError } from "@/services/admin/admin.service";
import { PayoutError } from "@/services/payments/payouts.service";

export type { ActionResult, FormState } from "@/lib/action-types";


const EXPECTED = [AuthorizationError, PlanLimitError, ProductError, TeamError, ConversationError, CustomerError, OutboundMessageError, OrderError, PaymentError, BillingError, AdminError, PayoutError];

/** Converts expected domain errors into user messages; logs and hides everything else. */
export function toActionError(err: unknown, context: Record<string, unknown> = {}): string {
  if (EXPECTED.some((E) => err instanceof E)) return (err as Error).message;
  logger.error("action.failed", err, context);
  return "Something went wrong. Please try again.";
}
