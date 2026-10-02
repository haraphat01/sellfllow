import { EVENTS, inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { respondToConversation } from "@/services/ai/agent.service";
import { applyHandoff } from "@/services/ai/tools";

type Data = { businessId?: unknown; conversationId?: unknown };
const UUID = /^[0-9a-f-]{36}$/;

/**
 * AI reply for a conversation. Debounced per conversation so a burst of
 * customer messages ("hi" / "how much" / "for the black one") gets one
 * considered reply, and never more than one run per conversation at a time.
 * If every retry fails, the conversation is handed to a human.
 */
export const aiRespondJob = inngest.createFunction(
  {
    id: "ai-respond",
    triggers: [{ event: EVENTS.conversationMessageReceived }],
    debounce: { key: "event.data.conversationId", period: "3s", timeout: "20s" },
    concurrency: { key: "event.data.conversationId", limit: 1 },
    retries: 2,
    onFailure: async ({ event, error }) => {
      const original = (event.data as { event?: { data?: Data } }).event?.data ?? {};
      const businessId = String(original.businessId ?? "");
      const conversationId = String(original.conversationId ?? "");
      if (!UUID.test(businessId) || !UUID.test(conversationId)) return;
      logger.error("ai.respond.failed", error, { business_id: businessId, conversation_id: conversationId });
      await applyHandoff(createAdminClient(), {
        businessId,
        conversationId,
        reason: "ai_error",
        summary: "The AI couldn't reply to this customer (technical error). Please take over.",
      });
    },
  },
  async ({ event, step }) => {
    const data = event.data as Data;
    const businessId = String(data.businessId ?? "");
    const conversationId = String(data.conversationId ?? "");
    if (!UUID.test(businessId) || !UUID.test(conversationId)) return { outcome: "skipped", reason: "invalid event" };

    return step.run("respond", () => respondToConversation(createAdminClient(), { businessId, conversationId }));
  },
);
