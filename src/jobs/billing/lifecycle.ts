import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { advanceSubscriptionStates, processRenewals, sendUsageAlerts } from "@/services/billing/billing.service";

/**
 * Hourly: renew subscriptions whose period ended (saved card, or a payment
 * link), then expire trials / grace periods / cancellations, then usage alerts.
 */
export const billingLifecycleJob = inngest.createFunction(
  { id: "billing-lifecycle", triggers: [{ cron: "5 * * * *" }], concurrency: { limit: 1 } },
  async ({ step }) => {
    const renewals = await step.run("renew", () => processRenewals(createAdminClient()));
    const states = await step.run("advance-states", () => advanceSubscriptionStates(createAdminClient()));
    const alerts = await step.run("usage-alerts", () => sendUsageAlerts(createAdminClient()));
    if (renewals.length || states.expired || states.trials_expired || states.cancelled || alerts.sent) {
      logger.info("billing.lifecycle", { renewals: renewals.length, ...states, alerts: alerts.sent });
    }
    return { renewals, states, alerts };
  },
);
