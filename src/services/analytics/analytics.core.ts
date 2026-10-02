/**
 * Pure analytics helpers: reporting periods and derived metrics. The raw
 * numbers come from the `analytics_report` database function.
 */
import { safeTimeZone, startOfLocalDay } from "@/lib/timezone";

export const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type RangeKey = keyof typeof RANGES;

export function parseRange(v: unknown): RangeKey {
  return typeof v === "string" && v in RANGES ? (v as RangeKey) : "30d";
}

/**
 * The last N local days including today (today is partial), and the N days
 * before that for comparison.
 */
export function periodFor(range: RangeKey, timeZone: string, now = new Date()) {
  const tz = safeTimeZone(timeZone);
  const days = RANGES[range];
  const from = startOfLocalDay(now, tz, days - 1);
  const prevFrom = startOfLocalDay(now, tz, 2 * days - 1);
  return { days, from, to: now, prevFrom, prevTo: from };
}

export type AnalyticsReport = {
  currency: string;
  timezone: string;
  revenue_minor: number;
  orders_paid: number;
  refunded_minor: number;
  orders_created: number;
  conversations_new: number;
  conversations_active: number;
  ai_conversations: number;
  handoffs: number;
  leads: number;
  leads_converted: number;
  ai_assisted_orders: number;
  ai_assisted_revenue_minor: number;
  recovered_orders: number;
  recovered_revenue_minor: number;
  follow_ups_sent: number;
  daily: { day: string; revenue_minor: number; orders: number; conversations: number; leads: number }[];
  top_products: { name: string; quantity: number; revenue_minor: number }[];
};

export function derived(r: AnalyticsReport) {
  return {
    conversionRate: r.leads ? r.leads_converted / r.leads : null,
    averageOrderMinor: r.orders_paid ? Math.round(r.revenue_minor / r.orders_paid) : null,
    aiShare: r.revenue_minor ? r.ai_assisted_revenue_minor / r.revenue_minor : null,
    recoveryRate: r.follow_ups_sent ? r.recovered_orders / r.follow_ups_sent : null,
  };
}

/** Relative change; null when there's no baseline to compare with. */
export function change(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

export function percent(v: number | null, digits = 1) {
  return v === null ? "—" : `${(v * 100).toFixed(digits).replace(/\.0$/, "")}%`;
}
