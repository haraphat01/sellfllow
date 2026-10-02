import { describe, expect, it } from "vitest";

import { extendTrialSchema, grantPlanSchema, planFromForm, suspendSchema } from "@/lib/validation/admin";

const ID = "b064b699-3e7f-4a4d-aaa9-5b6d81cd39a4";

describe("admin actions validation", () => {
  it("requires a reason for every business action", () => {
    expect(suspendSchema.safeParse({ businessId: ID, suspend: true, reason: "" }).success).toBe(false);
    expect(suspendSchema.safeParse({ businessId: ID, suspend: true, reason: "Chargeback fraud reported" }).success).toBe(true);
    expect(grantPlanSchema.safeParse({ businessId: ID, planCode: "growth", days: 30, reason: "  " }).success).toBe(false);
  });
  it("bounds grant and trial lengths", () => {
    expect(grantPlanSchema.safeParse({ businessId: ID, planCode: "growth", days: 400, reason: "partner" }).success).toBe(false);
    expect(extendTrialSchema.safeParse({ businessId: ID, days: 0, reason: "demo" }).success).toBe(false);
    expect(extendTrialSchema.safeParse({ businessId: ID, days: 14, reason: "demo call" }).success).toBe(true);
  });
  it("rejects a non-uuid business id", () => {
    expect(suspendSchema.safeParse({ businessId: "1 or 1=1", suspend: true, reason: "test test" }).success).toBe(false);
  });
});

describe("plan form", () => {
  const form = (o: Record<string, string> = {}) => {
    const f = new FormData();
    const base: Record<string, string> = { code: "business", name: "Business", description: "", price: "99,900", interval: "monthly", sort_order: "4", limit_messages: "100000", limit_customers: "", is_active: "on" };
    Object.entries({ ...base, ...o }).forEach(([k, v]) => f.set(k, v));
    return f;
  };
  it("parses money, unlimited limits and checkboxes", () => {
    const r = planFromForm(form({ feature_api: "on" }));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toMatchObject({ price: 9_990_000, is_active: true, is_public: false, description: null });
    expect(r.data.limits.messages).toBe(100_000);
    expect(r.data.limits.customers).toBeNull();
    expect(r.data.features).toMatchObject({ api: true, follow_ups: false });
  });
  it("rejects bad codes, prices and limits", () => {
    expect(planFromForm(form({ code: "Big Plan" })).success).toBe(false);
    expect(planFromForm(form({ price: "free" })).success).toBe(false);
    expect(planFromForm(form({ limit_orders: "-5" })).success).toBe(false);
    expect(planFromForm(form({ limit_orders: "2.5" })).success).toBe(false);
  });
});
