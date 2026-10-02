import { EVENTS, inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { dueFollowUps, processFollowUp, scheduleFollowUps } from "@/services/automation/follow-ups.service";

const UUID = /^[0-9a-f-]{36}$/;

/**
 * Every 5 minutes: detect inactive leads and schedule follow-ups (in the
 * database), then fan out one event per due follow-up.
 */
export const followUpSchedulerJob = inngest.createFunction(
  { id: "follow-ups-scheduler", triggers: [{ cron: "*/5 * * * *" }] },
  async ({ step }) => {
    const scheduled = await step.run("schedule", () => scheduleFollowUps(createAdminClient()));
    const due = await step.run("find-due", () => dueFollowUps(createAdminClient()));
    if (due.length) {
      await step.sendEvent(
        "dispatch",
        due.map((f) => ({ name: EVENTS.followUpDue, data: { followUpId: f.id, businessId: f.business_id } })),
      );
    }
    if (scheduled.cancelled || scheduled.scheduled || due.length) logger.info("follow_ups.tick", { ...scheduled, due: due.length });
    return { ...scheduled, due: due.length };
  },
);

/**
 * Sends one follow-up after re-checking every stop condition. Sending is
 * claimed in the database first, so duplicate events can't send twice.
 */
export const followUpSendJob = inngest.createFunction(
  {
    id: "follow-up-send",
    triggers: [{ event: EVENTS.followUpDue }],
    concurrency: [{ key: "event.data.businessId", limit: 5 }],
    retries: 3,
  },
  async ({ event, step }) => {
    const followUpId = String((event.data as { followUpId?: unknown }).followUpId ?? "");
    if (!UUID.test(followUpId)) return { outcome: "noop", reason: "invalid event" };
    return step.run("process", () => processFollowUp(createAdminClient(), followUpId));
  },
);
