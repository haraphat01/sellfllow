import "server-only";

import { debounced, inBackground, serialized, withRetries } from "@/lib/jobs/runner";
import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { respondToConversation } from "@/services/ai/agent.service";
import { applyHandoff } from "@/services/ai/tools";
import { flagUnpayableOrder, notifyPaymentReceived } from "@/services/payments/notify.service";
import { processWhatsAppEvent, type QueuedEvent } from "@/services/whatsapp/inbound.service";
import { sendConversationText } from "@/services/whatsapp/outbound.service";

/**
 * Event-driven background work, run in-process after the HTTP response.
 * Ordering, debouncing and retries mirror what Inngest used to provide; the
 * scheduled sweeps (src/jobs/scheduled.ts) recover anything a restart interrupts.
 */

const OPT_CONFIRMATION = {
  opt_out: "You won't receive automated messages from us anymore. You can still message us anytime, and reply START to turn them back on.",
  opt_in: "You're subscribed to updates again. Reply STOP anytime to opt out.",
} as const;

/** AI reply: wait for a burst of messages to settle (3s, max 20s), then one reply at a time per conversation. */
const AI_DEBOUNCE_MS = 3_000;
const AI_DEBOUNCE_MAX_MS = 20_000;

/** Processes one stored webhook event (idempotent). Exported for the sweeper. */
export async function processEvent(event: QueuedEvent) {
  const admin = createAdminClient();
  const result = await withRetries(() => processWhatsAppEvent(admin, event.id), { attempts: 3, baseDelayMs: 2_000, name: "whatsapp-process-event" });
  if (result.outcome !== "message") return result;

  if (result.optChange) {
    const change = result.optChange;
    await withRetries(
      () => sendConversationText(admin, { businessId: result.businessId, conversationId: result.conversationId, body: OPT_CONFIRMATION[change], sender: "system" }),
      { attempts: 3, baseDelayMs: 2_000, name: "opt-confirmation" },
    ).catch((err) => logger.error("whatsapp.opt_confirmation_failed", err, { business_id: result.businessId }));
  }
  if (result.aiMode === "AI_ACTIVE" && !result.isOptKeyword) scheduleAiReply(result.businessId, result.conversationId);
  return result;
}

/** Called by the WhatsApp webhook: each customer's events are processed in order. */
export function dispatchWhatsAppEvents(events: QueuedEvent[]) {
  for (const event of events) {
    inBackground("whatsapp-process-event", () => serialized(`wa:${event.concurrencyKey}`, () => processEvent(event)));
  }
}

/** One considered AI reply per burst of customer messages; if every attempt fails, the team takes over. */
export function scheduleAiReply(businessId: string, conversationId: string) {
  debounced(`ai:${conversationId}`, AI_DEBOUNCE_MS, AI_DEBOUNCE_MAX_MS, () => replyNow(businessId, conversationId));
}

export function replyNow(businessId: string, conversationId: string) {
  return serialized(`ai:${conversationId}`, async () => {
    const admin = createAdminClient();
    try {
      return await withRetries(() => respondToConversation(admin, { businessId, conversationId }), { attempts: 3, baseDelayMs: 2_000, name: "ai-respond" });
    } catch (err) {
      logger.error("ai.respond.failed", err, { business_id: businessId, conversation_id: conversationId });
      await applyHandoff(admin, { businessId, conversationId, reason: "ai_error", summary: "The AI couldn't reply to this customer (technical error). Please take over.", stopAi: true });
      return null;
    }
  });
}

/** After a verified payment: confirm to the customer on WhatsApp. */
export function dispatchPaymentSucceeded(p: { businessId: string; orderId: string }) {
  inBackground("payment-confirmation", () =>
    serialized(`pay:${p.orderId}`, () => withRetries(() => notifyPaymentReceived(createAdminClient(), p), { attempts: 4, baseDelayMs: 2_000, name: "payment-confirmation" })),
  );
}

/** A verified payment for an order that can no longer be paid: flag it for the team. */
export function dispatchUnpayableOrder(p: { businessId: string; orderId: string; orderNumber: number }) {
  inBackground("payment-unpayable-order", () => withRetries(() => flagUnpayableOrder(createAdminClient(), p), { attempts: 3, baseDelayMs: 2_000, name: "payment-unpayable-order" }));
}
