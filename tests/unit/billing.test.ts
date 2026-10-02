import { describe, expect, it } from "vitest";

import { addPlanInterval, MIN_CHARGE_MINOR, planChange, prorateUpgrade, usageAlertLevel, type SubscriptionState } from "@/services/billing/billing.core";
import { isSubscriptionUsable, usagePeriodStart } from "@/services/billing/limits";

const sub = (o: Partial<SubscriptionState> = {}): SubscriptionState => ({
  status: "active",
  planCode: "growth",
  priceMinor: 2_490_000,
  cancelAtPeriodEnd: false,
  periodStart: new Date("2026-09-01T00:00:00Z"),
  periodEnd: new Date("2026-10-01T00:00:00Z"),
  ...o,
});
const starter = { code: "starter", priceMinor: 990_000 };
const growth = { code: "growth", priceMinor: 2_490_000 };
const pro = { code: "pro", priceMinor: 5_990_000 };

describe("planChange", () => {
  it("subscribes from a trial, an expired or a cancelled plan — even to the same plan", () => {
    expect(planChange(sub({ status: "trialing", planCode: "starter" }), starter)).toBe("subscribe");
    expect(planChange(sub({ status: "expired" }), growth)).toBe("subscribe");
    expect(planChange(sub({ status: "cancelled" }), pro)).toBe("subscribe");
  });
  it("upgrades to pricier plans and schedules cheaper ones", () => {
    expect(planChange(sub(), pro)).toBe("upgrade");
    expect(planChange(sub(), starter)).toBe("downgrade");
  });
  it("same plan: nothing, or resume if cancelling", () => {
    expect(planChange(sub(), growth)).toBe("same");
    expect(planChange(sub({ cancelAtPeriodEnd: true }), growth)).toBe("resume");
  });
  it("past due must pay the outstanding renewal first", () => {
    expect(planChange(sub({ status: "past_due" }), pro)).toBe("pay_renewal");
  });
});

describe("prorateUpgrade", () => {
  const base = { fromPriceMinor: 2_490_000, toPriceMinor: 5_990_000, periodStart: new Date("2026-09-01T00:00:00Z"), periodEnd: new Date("2026-10-01T00:00:00Z") };
  it("charges the price difference for the unused part of the period", () => {
    expect(prorateUpgrade({ ...base, now: new Date("2026-09-01T00:00:00Z") })).toBe(3_500_000);
    expect(prorateUpgrade({ ...base, now: new Date("2026-09-16T00:00:00Z") })).toBe(1_750_000); // half the month left
  });
  it("rounds up to whole naira and never charges below the minimum", () => {
    expect(prorateUpgrade({ ...base, now: new Date("2026-09-10T07:00:00Z") }) % 100).toBe(0);
    expect(prorateUpgrade({ ...base, now: new Date("2026-09-30T23:59:00Z") })).toBe(MIN_CHARGE_MINOR);
  });
  it("is zero for a cheaper plan", () => {
    expect(prorateUpgrade({ ...base, fromPriceMinor: 5_990_000, toPriceMinor: 990_000, now: new Date("2026-09-10T00:00:00Z") })).toBe(0);
  });
});

describe("addPlanInterval", () => {
  it("adds a month like Postgres, clamping to the month's last day", () => {
    expect(addPlanInterval(new Date("2026-09-28T08:00:00Z"), "monthly").toISOString()).toBe("2026-10-28T08:00:00.000Z");
    expect(addPlanInterval(new Date("2027-01-31T08:00:00Z"), "monthly").toISOString()).toBe("2027-02-28T08:00:00.000Z");
    expect(addPlanInterval(new Date("2026-12-15T00:00:00Z"), "monthly").toISOString()).toBe("2027-01-15T00:00:00.000Z");
    expect(addPlanInterval(new Date("2028-02-29T00:00:00Z"), "annually").toISOString()).toBe("2029-02-28T00:00:00.000Z");
  });
});

describe("usage", () => {
  it("alerts at 80% and 100%", () => {
    expect(usageAlertLevel(239, 300)).toBeNull();
    expect(usageAlertLevel(240, 300)).toBe(0.8);
    expect(usageAlertLevel(300, 300)).toBe(1);
    expect(usageAlertLevel(10_000, null)).toBeNull();
  });
  it("keeps the product usable during the grace period only", () => {
    expect(["trialing", "active", "past_due"].every(isSubscriptionUsable)).toBe(true);
    expect(["expired", "cancelled"].some(isSubscriptionUsable)).toBe(false);
  });
  it("uses UTC calendar months like record_usage", () => {
    expect(usagePeriodStart(new Date("2026-09-30T23:30:00Z")).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});
