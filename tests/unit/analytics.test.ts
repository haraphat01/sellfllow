import { describe, expect, it } from "vitest";

import { startOfLocalDay } from "@/lib/timezone";
import { change, derived, parseRange, percent, periodFor, type AnalyticsReport } from "@/services/analytics/analytics.core";

const report = (o: Partial<AnalyticsReport>): AnalyticsReport => ({
  currency: "NGN",
  timezone: "Africa/Lagos",
  revenue_minor: 0,
  orders_paid: 0,
  refunded_minor: 0,
  orders_created: 0,
  conversations_new: 0,
  conversations_active: 0,
  ai_conversations: 0,
  handoffs: 0,
  leads: 0,
  leads_converted: 0,
  ai_assisted_orders: 0,
  ai_assisted_revenue_minor: 0,
  recovered_orders: 0,
  recovered_revenue_minor: 0,
  follow_ups_sent: 0,
  daily: [],
  top_products: [],
  ...o,
});

describe("periodFor", () => {
  it("covers the last N local days including today, with the previous N days for comparison", () => {
    const now = new Date("2026-09-28T07:30:00Z"); // 08:30 in Lagos
    const p = periodFor("7d", "Africa/Lagos", now);
    expect(p.from.toISOString()).toBe("2026-09-21T23:00:00.000Z"); // 22 Sep 00:00 Lagos
    expect(p.to).toEqual(now);
    expect(p.prevFrom.toISOString()).toBe("2026-09-14T23:00:00.000Z");
    expect(p.prevTo).toEqual(p.from);
  });
  it("uses local midnight, not UTC midnight", () => {
    // 23:30 UTC on the 27th is already the 28th in Lagos.
    expect(startOfLocalDay(new Date("2026-09-27T23:30:00Z"), "Africa/Lagos").toISOString()).toBe("2026-09-27T23:00:00.000Z");
  });
  it("defaults unknown ranges to 30 days", () => {
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange("365d")).toBe("30d");
    expect(parseRange(undefined)).toBe("30d");
    expect(parseRange(["7d"])).toBe("30d");
  });
});

describe("derived metrics", () => {
  it("computes conversion, AOV, AI share and recovery without dividing by zero", () => {
    expect(derived(report({}))).toEqual({ conversionRate: null, averageOrderMinor: null, aiShare: null, recoveryRate: null });
    expect(
      derived(report({ leads: 8, leads_converted: 2, revenue_minor: 9_000_000, orders_paid: 2, ai_assisted_revenue_minor: 4_500_000, follow_ups_sent: 4, recovered_orders: 1 })),
    ).toEqual({ conversionRate: 0.25, averageOrderMinor: 4_500_000, aiShare: 0.5, recoveryRate: 0.25 });
  });
  it("reports change only against a real baseline", () => {
    expect(change(150, 100)).toBe(0.5);
    expect(change(50, 100)).toBe(-0.5);
    expect(change(10, 0)).toBeNull();
    expect(change(null, 5)).toBeNull();
  });
  it("formats percentages", () => {
    expect(percent(0.204)).toBe("20.4%");
    expect(percent(0.25, 0)).toBe("25%");
    expect(percent(0.5)).toBe("50%");
    expect(percent(null)).toBe("—");
  });
});
