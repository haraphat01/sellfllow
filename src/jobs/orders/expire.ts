import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";

/** Hourly: cancel unpaid orders older than 48h so their reserved stock returns to inventory. */
export const expireStaleOrdersJob = inngest.createFunction(
  { id: "orders-expire-stale", triggers: [{ cron: "15 * * * *" }] },
  async ({ step }) => {
    const expired = await step.run("expire", async () => {
      const { data, error } = await createAdminClient().rpc("expire_stale_orders", { p_older_than: "48 hours" });
      if (error) throw error;
      return data ?? 0;
    });
    if (expired) logger.info("orders.expired", { count: expired });
    return { expired };
  },
);
