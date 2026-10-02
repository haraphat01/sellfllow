/**
 * Integration: subscription billing against a real Supabase project, the
 * running app (billing webhook) and the mock Paystack (scripts/mock-paystack.mjs).
 *
 *   RUN_INTEGRATION=1 E2E_BUSINESS_ID=<id> PAYSTACK_BASE_URL=http://127.0.0.1:8298 npm run test:integration
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = Boolean(process.env.RUN_INTEGRATION && process.env.E2E_BUSINESS_ID && process.env.PAYSTACK_BASE_URL && process.env.PAYSTACK_SECRET_KEY);
const BIZ = process.env.E2E_BUSINESS_ID ?? "";
const APP = process.env.E2E_APP_URL ?? "http://localhost:3000";
const MOCK = process.env.PAYSTACK_BASE_URL ?? "";

describe.skipIf(!run)("Subscription billing (integration)", { timeout: 90_000 }, async () => {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { signPaystackPayload } = await import("@/lib/paystack/signature");
  const { encryptSecret } = await import("@/lib/security/crypto");
  const billing = await import("@/services/billing/billing.service");
  const { prorateUpgrade } = await import("@/services/billing/billing.core");

  const admin = createAdminClient();
  const KEY = process.env.PAYSTACK_SECRET_KEY!;
  let original: Record<string, unknown> = {};
  let originalCard: { ciphertext: string; last_four: string | null } | null = null;
  let ownerId = "";
  const email = "billing-test@example.com";
  const startedAt = new Date().toISOString();

  const sub = async () => (await admin.from("subscriptions").select("*, plan:subscription_plans!subscriptions_plan_id_fkey(code)").eq("business_id", BIZ).single()).data!;
  const planCode = async () => (sub().then((s) => (s.plan as unknown as { code: string }).code));
  const refOf = (url: string) => decodeURIComponent(url.split("/checkout/")[1]);
  const pay = (reference: string, body: Record<string, unknown> = {}) => fetch(`${MOCK}/__pay/${encodeURIComponent(reference)}`, { method: "POST", body: JSON.stringify(body) });
  async function webhook(reference: string, signed = true, id = Date.now()) {
    const raw = JSON.stringify({ event: "charge.success", data: { id, reference, amount: 1, currency: "NGN", status: "success" } });
    const res = await fetch(`${APP}/api/webhooks/paystack/billing`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(signed ? { "x-paystack-signature": signPaystackPayload(raw, KEY) } : {}) },
      body: raw,
    });
    return res.status;
  }

  beforeAll(async () => {
    const { data: s } = await admin.from("subscriptions").select("*").eq("business_id", BIZ).single();
    original = s!;
    const { data: card } = await admin.from("business_credentials").select("ciphertext, last_four").eq("business_id", BIZ).eq("provider", "paystack").eq("label", "billing_authorization").maybeSingle();
    originalCard = card;
    await admin.from("business_credentials").delete().eq("business_id", BIZ).eq("provider", "paystack").eq("label", "billing_authorization");
    const { data: owner } = await admin.from("business_members").select("user_id").eq("business_id", BIZ).eq("role", "owner").single();
    ownerId = owner!.user_id;
    const { data: starter } = await admin.from("subscription_plans").select("id").eq("code", "starter").single();
    await admin
      .from("subscriptions")
      .update({ status: "trialing", plan_id: starter!.id, pending_plan_id: null, cancel_at_period_end: false, card_last4: null, card_brand: null, card_exp: null, billing_email: null, renewal_attempts: 0, past_due_since: null, next_renewal_attempt_at: null, trial_ends_at: new Date(Date.now() + 5 * 864e5).toISOString() })
      .eq("business_id", BIZ);
  });

  afterAll(async () => {
    await admin.from("billing_invoices").delete().eq("business_id", BIZ).gte("created_at", startedAt);
    await admin.from("notifications").delete().eq("business_id", BIZ).like("type", "billing.%").gte("created_at", startedAt);
    const { id: _i, business_id: _b, created_at: _c, updated_at: _u, ...restore } = original;
    void [_i, _b, _c, _u];
    await admin.from("subscriptions").update(restore as never).eq("business_id", BIZ);
    await admin.from("business_credentials").delete().eq("business_id", BIZ).eq("provider", "paystack").eq("label", "billing_authorization");
    if (originalCard) await admin.from("business_credentials").insert({ business_id: BIZ, provider: "paystack", label: "billing_authorization", ...originalCard });
  });

  it("subscribes from the trial: checkout, nothing changes until Paystack confirms, then the plan and card are saved", async () => {
    const res = await billing.changePlan(admin, { businessId: BIZ, planCode: "growth", userId: ownerId, email });
    expect(res.action).toBe("checkout");
    const reference = refOf((res as { url: string }).url);
    expect(reference.startsWith("sfb-")).toBe(true);

    // Returning to the app before paying (or a forged return) changes nothing.
    expect(await billing.confirmBillingPayment(admin, reference, { businessId: BIZ })).toMatchObject({ outcome: "pending" });
    expect((await sub()).status).toBe("trialing");

    // Unsigned webhook rejected.
    expect(await webhook(reference, false)).toBe(401);

    await pay(reference);
    expect(await webhook(reference)).toBe(200);
    const s = await sub();
    expect(s).toMatchObject({ status: "active", card_last4: "4081", billing_email: email });
    expect(await planCode()).toBe("growth");
    const len = new Date(s.current_period_end).getTime() - new Date(s.current_period_start).getTime();
    expect(len / 864e5).toBeGreaterThanOrEqual(28);
    const { data: inv } = await admin.from("billing_invoices").select("status, amount_minor, kind").eq("reference", reference).single();
    expect(inv).toMatchObject({ status: "paid", amount_minor: 2_490_000, kind: "subscribe" });

    // Replayed webhook and the return page are idempotent.
    expect(await webhook(reference)).toBe(200);
    expect(await billing.confirmBillingPayment(admin, reference, { businessId: BIZ })).toMatchObject({ outcome: "already_paid" });
    // Another business can't confirm this reference.
    expect(await billing.confirmBillingPayment(admin, reference, { businessId: "00000000-0000-0000-0000-000000000000" })).toMatchObject({ outcome: "unknown" });
  });

  it("upgrades immediately on the saved card, prorated, keeping the period", async () => {
    const before = await sub();
    const res = await billing.changePlan(admin, { businessId: BIZ, planCode: "pro", userId: ownerId, email });
    expect(res).toMatchObject({ action: "charged", planName: "Pro" });
    const after = await sub();
    expect(await planCode()).toBe("pro");
    expect(after.current_period_end).toBe(before.current_period_end);
    const { data: inv } = await admin.from("billing_invoices").select("amount_minor, status").eq("business_id", BIZ).eq("kind", "upgrade").order("created_at", { ascending: false }).limit(1).single();
    const expected = prorateUpgrade({ fromPriceMinor: 2_490_000, toPriceMinor: 5_990_000, periodStart: new Date(before.current_period_start), periodEnd: new Date(before.current_period_end), now: new Date() });
    expect(inv!.status).toBe("paid");
    expect(Math.abs(inv!.amount_minor - expected)).toBeLessThanOrEqual(100);
  });

  it("schedules a downgrade and applies it at renewal, charging the saved card", async () => {
    const res = await billing.changePlan(admin, { businessId: BIZ, planCode: "starter", userId: ownerId, email });
    expect(res.action).toBe("scheduled_downgrade");
    expect(await planCode()).toBe("pro");

    const oldEnd = new Date(Date.now() - 60_000).toISOString();
    await admin.from("subscriptions").update({ current_period_end: oldEnd }).eq("business_id", BIZ);
    const results = await billing.processRenewals(admin);
    expect(results.find((r) => r.outcome === "renewed")).toBeTruthy();
    const s = await sub();
    expect(await planCode()).toBe("starter");
    expect(s).toMatchObject({ status: "active", pending_plan_id: null });
    expect(new Date(s.current_period_start).toISOString()).toBe(new Date(oldEnd).toISOString());
    const { data: inv } = await admin.from("billing_invoices").select("amount_minor, status").eq("business_id", BIZ).eq("kind", "renewal").order("created_at", { ascending: false }).limit(1).single();
    expect(inv).toMatchObject({ amount_minor: 990_000, status: "paid" });
  });

  it("a declined renewal goes past due with a payment link; paying it restores the subscription", async () => {
    await admin
      .from("business_credentials")
      .update({ ciphertext: encryptSecret(JSON.stringify({ code: "AUTH_DECLINE_test", email }), BIZ) })
      .eq("business_id", BIZ)
      .eq("provider", "paystack")
      .eq("label", "billing_authorization");
    await admin.from("subscriptions").update({ current_period_end: new Date(Date.now() - 60_000).toISOString() }).eq("business_id", BIZ);

    const results = await billing.processRenewals(admin);
    expect(results[0]).toMatchObject({ outcome: "failed" });
    const s = await sub();
    expect(s).toMatchObject({ status: "past_due", renewal_attempts: 1 });
    expect(s.past_due_since).toBeTruthy();
    // Retried tomorrow, not on the next hourly run.
    expect(await billing.processRenewals(admin)).toHaveLength(0);

    const { data: note } = await admin.from("notifications").select("data").eq("business_id", BIZ).eq("type", "billing.payment_needed").order("created_at", { ascending: false }).limit(1).single();
    const url = (note!.data as { url: string }).url;
    expect(url).toContain("/checkout/");

    // Past due still works (grace period) and the only plan action is paying.
    const again = await billing.changePlan(admin, { businessId: BIZ, planCode: "pro", userId: ownerId, email });
    expect(again).toMatchObject({ action: "pay_renewal", url });

    const reference = refOf(url);
    await pay(reference);
    expect(await webhook(reference)).toBe(200);
    expect(await sub()).toMatchObject({ status: "active", renewal_attempts: 0, past_due_since: null });
  });

  it("cancels at the end of the period", async () => {
    await billing.cancelAtPeriodEnd(admin, { businessId: BIZ, userId: ownerId });
    expect((await sub()).cancel_at_period_end).toBe(true);
    // Resuming is a plan action on the same plan.
    expect(await billing.changePlan(admin, { businessId: BIZ, planCode: "starter", userId: ownerId, email })).toMatchObject({ action: "resumed" });
    await billing.cancelAtPeriodEnd(admin, { businessId: BIZ, userId: ownerId });

    await admin.from("subscriptions").update({ current_period_end: new Date(Date.now() - 60_000).toISOString() }).eq("business_id", BIZ);
    expect(await billing.processRenewals(admin)).toHaveLength(0); // no renewal for a cancelling plan
    await billing.advanceSubscriptionStates(admin);
    expect(await sub()).toMatchObject({ status: "cancelled" });
  });
});
