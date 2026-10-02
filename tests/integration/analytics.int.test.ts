/**
 * Integration: analytics_report against a real Supabase project, cross-checked
 * with direct queries over the same period.
 *
 *   RUN_INTEGRATION=1 E2E_BUSINESS_ID=<id> npm run test:integration
 */
import { describe, expect, it } from "vitest";

const run = Boolean(process.env.RUN_INTEGRATION && process.env.E2E_BUSINESS_ID);
const BIZ = process.env.E2E_BUSINESS_ID ?? "";

describe.skipIf(!run)("Analytics (integration)", { timeout: 60_000 }, async () => {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { getAnalytics, getReport } = await import("@/services/analytics/analytics.service");
  const admin = createAdminClient();

  it("matches the orders table for the last 90 days", async () => {
    const { data: biz } = await admin.from("businesses").select("timezone").eq("id", BIZ).single();
    const { current: r, period } = await getAnalytics(admin, BIZ, biz!.timezone, "90d", { compare: false });

    const { data: paid } = await admin
      .from("orders")
      .select("total_minor, status, ai_assisted, recovered_by_follow_up_id")
      .eq("business_id", BIZ)
      .gte("paid_at", period.from.toISOString())
      .lt("paid_at", period.to.toISOString());
    const net = (paid ?? []).filter((o) => o.status !== "refunded");
    const sum = (rows: { total_minor: number }[]) => rows.reduce((s, o) => s + Number(o.total_minor), 0);

    expect(r.revenue_minor).toBe(sum(net));
    expect(r.orders_paid).toBe(net.length);
    expect(r.ai_assisted_revenue_minor).toBe(sum(net.filter((o) => o.ai_assisted)));
    expect(r.recovered_orders).toBe(net.filter((o) => o.recovered_by_follow_up_id).length);
    expect(r.daily).toHaveLength(90);
    expect(r.daily.reduce((s, d) => s + d.revenue_minor, 0)).toBe(r.revenue_minor);
    expect(r.leads_converted).toBeLessThanOrEqual(r.leads);
    expect(r.orders_paid).toBeGreaterThan(0); // the E2E business has real test sales (e.g. order #1033)
  });

  it("refuses an anonymous caller", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!, {
      auth: { persistSession: false },
    });
    await expect(getReport(anon as never, BIZ, new Date(Date.now() - 86_400_000), new Date())).rejects.toMatchObject({ code: "42501" });
  });
});
