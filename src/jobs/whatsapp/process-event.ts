import { EVENTS, inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { findEventsToRetry, processWhatsAppEvent } from "@/services/whatsapp/inbound.service";
import { sendConversationText } from "@/services/whatsapp/outbound.service";

const OPT_CONFIRMATION = {
  opt_out: "You won't receive automated messages from us anymore. You can still message us anytime, and reply START to turn them back on.",
  opt_in: "You're subscribed to updates again. Reply STOP anytime to opt out.",
} as const;

/**
 * Processes one stored Meta webhook event. Events for the same customer run
 * one at a time (ordering); retries are safe because processing is idempotent.
 */
export const processWhatsAppEventJob = inngest.createFunction(
  {
    id: "whatsapp-process-event",
    triggers: [{ event: EVENTS.whatsappEventReceived }],
    concurrency: { key: "event.data.concurrencyKey", limit: 1 },
    retries: 6,
  },
  async ({ event, step }) => {
    const eventId = String((event.data as { eventId?: unknown }).eventId ?? "");
    if (!/^[0-9a-f-]{36}$/.test(eventId)) return { outcome: "skipped", reason: "invalid event id" };

    const result = await step.run("process", () => processWhatsAppEvent(createAdminClient(), eventId));
    if (result.outcome !== "message") return result;

    if (result.optChange) {
      const change = result.optChange;
      await step.run("confirm-opt-change", () =>
        sendConversationText(createAdminClient(), {
          businessId: result.businessId,
          conversationId: result.conversationId,
          body: OPT_CONFIRMATION[change],
          sender: "system",
        }),
      );
    }

    // Hand-off point for the AI sales agent (Phase 5).
    if (result.aiMode === "AI_ACTIVE" && !result.isOptKeyword) {
      await step.sendEvent("notify-conversation", {
        name: EVENTS.conversationMessageReceived,
        data: { businessId: result.businessId, conversationId: result.conversationId, messageId: result.messageId },
      });
    }
    return result;
  },
);

/** Every 10 minutes: re-enqueue WhatsApp events whose processing never completed. */
export const whatsappEventSweeperJob = inngest.createFunction(
  { id: "whatsapp-event-sweeper", triggers: [{ cron: "*/10 * * * *" }] },
  async ({ step }) => {
    const events = await step.run("find", () => findEventsToRetry(createAdminClient()));
    if (events.length) {
      await step.sendEvent(
        "requeue",
        // No event id: the webhook's `whatsapp-event-<id>` would be deduplicated by Inngest. Processing claims the event, so duplicates are harmless.
        events.map((e) => ({ name: EVENTS.whatsappEventReceived, data: { eventId: e.id, businessId: e.businessId, concurrencyKey: e.concurrencyKey } })),
      );
      logger.warn("whatsapp.events.requeued", { count: events.length });
    }
    return { requeued: events.length };
  },
);
