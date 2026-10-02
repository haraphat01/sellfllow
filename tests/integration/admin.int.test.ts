/**
 * Integration: platform admin service against a real Supabase project.
 *
 *   RUN_INTEGRATION=1 E2E_BUSINESS_ID=<id> npm run test:integration
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = Boolean(process.env.RUN_INTEGRATION && process.env.E2E_BUSINESS_ID);
const BIZ = process.env.E2E_BUSINESS_ID ?? "";

describe.skipIf(!run)("Platform admin (integration)", { timeout: 60_000 }, async () => {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const adminSvc = await import("@/services/admin/admin.service");
  const { processRenewals } = await import("@/services/billing/billing.service");
  const admin = createAdminClient();
  let originalSub: Record<string, unknown> = {};
  let adminId = "";
  const startedAt = new Date().toISOString();
  const testPlanCode = `itest_${Date.now().toString(36)}`;

  beforeAll(async () => {
    const { data: s } = await admin.from("subscriptions").select("*").eq("business_id", BIZ).single();
    originalSub = s!;
    const { data: owner } = await admin.from("business_members").select("user_id").eq("business_id", BIZ).eq("role", "owner").single();
    adminId = owner!.user_id; // any real user id works as the audit actor here
  });

  afterAll(async () => {
    const { id: _i, business_id: _b, created_at: _c, updated_at: _u, ...restore } = originalSub;
    void [_i, _b, _c, _u];
    await admin.from("subscriptions").update(restore as never).eq("business_id", BIZ);
    await admin.from("businesses").update({ status: "active", suspended_reason: null }).eq("id", BIZ);
    await admin.from("billing_events").delete().eq("business_id", BIZ).eq("type", "admin.plan_granted").gte("created_at", startedAt);
    await admin.from("notifications").delete().eq("business_id", BIZ).like("type", "platform.%").gte("created_at", startedAt);
    await admin.from("subscription_plans").delete().eq("code", testPlanCode);
  });

  it("platform stats match direct counts", async () => {
    const s = await adminSvc.getPlatformStats(admin, 30);
    const { count: total } = await admin.from("businesses").select("id", { count: "exact", head: true });
    const { count: active } = await admin.from("businesses").select("id", { count: "exact", head: true }).eq("status", "active");
    expect(s.businesses_total).toBe(total);
    expect(s.businesses_active).toBe(active);
    expect(s.orders_paid).toBeGreaterThanOrEqual(1); // order #1033
    expect(s.payment_volume.NGN).toBeGreaterThanOrEqual(4_900_000);
  });

  it("finds a business by name, slug, member email and id", async () => {
    const { data: b } = await admin.from("businesses").select("name, slug").eq("id", BIZ).single();
    const { data: owner } = await admin.from("profiles").select("email").eq("id", adminId).single();
    for (const q of [b!.name.slice(0, 5), b!.slug, owner!.email, BIZ]) {
      const res = await adminSvc.searchBusinesses(admin, { q });
      expect(res.rows.map((r) => r.id), `query ${q}`).toContain(BIZ);
    }
    expect((await adminSvc.searchBusinesses(admin, { q: "zz-no-such-business-zz" })).total).toBe(0);
  });

  it("grants a complimentary plan that isn't revenue and doesn't renew", async () => {
    const before = await adminSvc.getPlatformStats(admin, 30);
    const res = await adminSvc.grantPlan(admin, { businessId: BIZ, planCode: "pro", days: 30, reason: "integration test", adminId });
    expect(res.planName).toBe("Pro");
    const { data: sub } = await admin.from("subscriptions").select("status, is_complimentary, cancel_at_period_end, plan:subscription_plans!subscriptions_plan_id_fkey(code)").eq("business_id", BIZ).single();
    expect(sub).toMatchObject({ status: "active", is_complimentary: true, cancel_at_period_end: true, plan: { code: "pro" } });
    const after = await adminSvc.getPlatformStats(admin, 30);
    expect(after.mrr_minor).toBe(before.mrr_minor);
    expect(after.complimentary).toBe(before.complimentary + (originalSub.is_complimentary ? 0 : 1));
    const { data: log } = await admin.from("audit_logs").select("actor_type, metadata").eq("business_id", BIZ).eq("action", "admin.plan_granted").order("created_at", { ascending: false }).limit(1).single();
    expect(log).toMatchObject({ actor_type: "admin", metadata: { plan: "pro", reason: "integration test" } });

    // Trials can't be extended over a granted plan.
    await expect(adminSvc.extendTrial(admin, { businessId: BIZ, days: 7, reason: "test", adminId })).rejects.toThrow(/grant a plan instead/);
  });

  it("suspends (no renewals are charged) and reinstates", async () => {
    await adminSvc.setBusinessSuspended(admin, { businessId: BIZ, suspend: true, reason: "integration test", adminId });
    const { data: b } = await admin.from("businesses").select("status, suspended_reason").eq("id", BIZ).single();
    expect(b).toMatchObject({ status: "suspended", suspended_reason: "integration test" });
    await expect(adminSvc.setBusinessSuspended(admin, { businessId: BIZ, suspend: true, reason: "again", adminId })).rejects.toThrow(/isn't active/);

    // A due renewal for a suspended business is skipped, not charged.
    await admin.from("subscriptions").update({ cancel_at_period_end: false, current_period_end: new Date(Date.now() - 60_000).toISOString() }).eq("business_id", BIZ);
    const results = await processRenewals(admin);
    const mine = results.find((r) => r.outcome === "skipped" && r.reason === "business suspended");
    if (process.env.PAYSTACK_SECRET_KEY) expect(mine).toBeTruthy();

    await adminSvc.setBusinessSuspended(admin, { businessId: BIZ, suspend: false, reason: "resolved", adminId });
    const { data: b2 } = await admin.from("businesses").select("status, suspended_reason").eq("id", BIZ).single();
    expect(b2).toMatchObject({ status: "active", suspended_reason: null });
    const { count } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("business_id", BIZ).like("type", "platform.%").gte("created_at", startedAt);
    expect(count).toBe(2);
  });

  it("creates and edits plans, but a plan's code is fixed", async () => {
    const plan = {
      code: testPlanCode,
      name: "Test Plan",
      description: null,
      price: 1_000_000,
      interval: "monthly" as const,
      sort_order: 99,
      is_active: true,
      is_public: false,
      limits: { messages: 10, customers: null },
      features: { follow_ups: true },
    };
    await adminSvc.savePlan(admin, { plan, existingId: null, adminId });
    await expect(adminSvc.savePlan(admin, { plan, existingId: null, adminId })).rejects.toThrow(/already exists/);
    const { data: row } = await admin.from("subscription_plans").select("id, price_minor, is_public").eq("code", testPlanCode).single();
    expect(row).toMatchObject({ price_minor: 1_000_000, is_public: false });
    await adminSvc.savePlan(admin, { plan: { ...plan, price: 1_500_000 }, existingId: row!.id, adminId });
    expect((await admin.from("subscription_plans").select("price_minor").eq("id", row!.id).single()).data?.price_minor).toBe(1_500_000);
    await expect(adminSvc.savePlan(admin, { plan: { ...plan, code: "other_code" }, existingId: row!.id, adminId })).rejects.toThrow(/can't be changed/);
  });
});
