import "server-only";

import type { DbClient } from "@/lib/supabase/types";

import { periodFor, type AnalyticsReport, type RangeKey } from "./analytics.core";

/**
 * Analytics for one business. Works with the user's client (the database
 * checks analytics.view) or the service role.
 */
export async function getReport(db: DbClient, businessId: string, from: Date, to: Date): Promise<AnalyticsReport> {
  const { data, error } = await db.rpc("analytics_report", { p_business_id: businessId, p_from: from.toISOString(), p_to: to.toISOString() });
  if (error) throw error;
  const r = data as unknown as AnalyticsReport;
  // bigint sums arrive as numbers or numeric strings; normalise.
  const n = (v: unknown) => Number(v ?? 0);
  return {
    ...r,
    revenue_minor: n(r.revenue_minor),
    refunded_minor: n(r.refunded_minor),
    ai_assisted_revenue_minor: n(r.ai_assisted_revenue_minor),
    recovered_revenue_minor: n(r.recovered_revenue_minor),
    daily: r.daily.map((d) => ({ ...d, revenue_minor: n(d.revenue_minor) })),
    top_products: r.top_products.map((p) => ({ ...p, quantity: n(p.quantity), revenue_minor: n(p.revenue_minor) })),
  };
}

export async function getAnalytics(db: DbClient, businessId: string, timeZone: string, range: RangeKey, opts: { compare: boolean }, now = new Date()) {
  const period = periodFor(range, timeZone, now);
  const [current, previous] = await Promise.all([
    getReport(db, businessId, period.from, period.to),
    opts.compare ? getReport(db, businessId, period.prevFrom, period.prevTo) : Promise.resolve(null),
  ]);
  return { period, current, previous };
}
