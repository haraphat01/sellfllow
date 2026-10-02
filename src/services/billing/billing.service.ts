import "server-only";

import { randomBytes } from "node:crypto";

import { serverEnv } from "@/lib/env/server";
import { publicEnv } from "@/lib/env/public";
import { formatMoney } from "@/lib/money";
import { logger } from "@/lib/observability/logger";
import { paystackClient, PaystackError, type PaystackTransaction } from "@/lib/paystack/client";
import { verifyPaystackSignature } from "@/lib/paystack/signature";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import type { DbClient } from "@/lib/supabase/types";
import type { Json } from "@/db/types/database";

import { addPlanInterval, planChange, prorateUpgrade, RENEWAL_MAX_ATTEMPTS, RENEWAL_RETRY_MS, usageAlertLevel, type SubscriptionState } from "./billing.core";
import { currentUsage, getPlan, isSubscriptionUsable, usagePeriodStart } from "./limits";

/**
 * SellFlow's own subscription billing, charged to SellFlow's Paystack account
 * (PAYSTACK_SECRET_KEY) — never a merchant's key. Plans change only via
 * `apply_billing_payment` after Paystack confirms the charge server-side.
 */

export class BillingError extends Error {
  constructor(
    message: string,
    public reason: "not_configured" | "invalid" | "provider" = "invalid",
  ) {
    super(message);
    this.name = "BillingError";
  }
}

const AUTH_LABEL = "billing_authorization";
const REFERENCE_PREFIX = "sfb-";

function platformPaystack() {
  const key = serverEnv().PAYSTACK_SECRET_KEY;
  if (!key) throw new BillingError("Billing isn't configured on this installation (missing PAYSTACK_SECRET_KEY).", "not_configured");
  return { client: paystackClient(key), key };
}

export function isBillingConfigured() {
  return Boolean(serverEnv().PAYSTACK_SECRET_KEY);
}

type PlanRow = { id: string; code: string; name: string; price_minor: number; currency: string; interval: string };
type SubRow = {
  id: string;
  business_id: string;
  status: SubscriptionState["status"];
  plan_id: string;
  pending_plan_id: string | null;
  cancel_at_period_end: boolean;
  current_period_start: string;
  current_period_end: string;
  billing_email: string | null;
  renewal_attempts: number;
  plan: PlanRow;
};

async function loadSubscription(admin: DbClient, businessId: string): Promise<SubRow> {
  const { data, error } = await admin
    .from("subscriptions")
    .select("id, business_id, status, plan_id, pending_plan_id, cancel_at_period_end, current_period_start, current_period_end, billing_email, renewal_attempts, plan:subscription_plans!subscriptions_plan_id_fkey(id, code, name, price_minor, currency, interval)")
    .eq("business_id", businessId)
    .single();
  if (error || !data) throw new BillingError("This business has no subscription.");
  return data as unknown as SubRow;
}

const stateOf = (s: SubRow): SubscriptionState => ({
  status: s.status,
  planCode: s.plan.code,
  priceMinor: s.plan.price_minor,
  cancelAtPeriodEnd: s.cancel_at_period_end,
  periodStart: new Date(s.current_period_start),
  periodEnd: new Date(s.current_period_end),
});

const newReference = () => `${REFERENCE_PREFIX}${randomBytes(9).toString("hex")}`;

async function savedAuthorization(admin: DbClient, businessId: string): Promise<{ code: string; email: string } | null> {
  const { data } = await admin.from("business_credentials").select("ciphertext").eq("business_id", businessId).eq("provider", "paystack").eq("label", AUTH_LABEL).maybeSingle();
  if (!data) return null;
  try {
    return JSON.parse(decryptSecret(data.ciphertext, businessId));
  } catch {
    return null;
  }
}

async function saveAuthorization(admin: DbClient, businessId: string, tx: PaystackTransaction, email: string) {
  const a = tx.authorization;
  if (!a?.reusable || !a.authorization_code) return;
  await admin.from("business_credentials").upsert(
    {
      business_id: businessId,
      provider: "paystack",
      label: AUTH_LABEL,
      ciphertext: encryptSecret(JSON.stringify({ code: a.authorization_code, email }), businessId),
      last_four: a.last4 ?? null,
    },
    { onConflict: "business_id,provider,label" },
  );
}

export async function removeSavedCard(admin: DbClient, p: { businessId: string; userId: string }) {
  await admin.from("business_credentials").delete().eq("business_id", p.businessId).eq("provider", "paystack").eq("label", AUTH_LABEL);
  await admin.from("subscriptions").update({ card_brand: null, card_last4: null, card_exp: null }).eq("business_id", p.businessId);
  await admin.from("audit_logs").insert({ business_id: p.businessId, actor_user_id: p.userId, action: "billing.card_removed" });
}

async function createInvoice(
  admin: DbClient,
  p: { sub: SubRow; plan: PlanRow; kind: "subscribe" | "upgrade" | "renewal"; amountMinor: number; userId?: string | null; periodStart?: Date; periodEnd?: Date },
) {
  const { data, error } = await admin
    .from("billing_invoices")
    .insert({
      business_id: p.sub.business_id,
      subscription_id: p.sub.id,
      plan_id: p.plan.id,
      kind: p.kind,
      amount_minor: p.amountMinor,
      currency: p.plan.currency,
      reference: newReference(),
      created_by: p.userId ?? null,
      period_start: p.periodStart?.toISOString() ?? null,
      period_end: p.periodEnd?.toISOString() ?? null,
    })
    .select("id, reference, amount_minor, currency")
    .single();
  if (error) throw error;
  return data;
}

async function checkoutLink(admin: DbClient, invoice: { id: string; reference: string; amount_minor: number; currency: string }, email: string, businessId: string) {
  const { client } = platformPaystack();
  const res = await client.initialize({
    email,
    amountMinor: invoice.amount_minor,
    currency: invoice.currency,
    reference: invoice.reference,
    callbackUrl: `${publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/billing/complete`,
    metadata: { sellflow_billing: true, business_id: businessId, invoice_id: invoice.id },
  });
  await admin.from("billing_invoices").update({ authorization_url: res.authorization_url }).eq("id", invoice.id);
  return res.authorization_url;
}

export type ChangePlanResult =
  | { action: "checkout"; url: string }
  | { action: "charged"; planName: string }
  | { action: "scheduled_downgrade"; planName: string; effective: string }
  | { action: "resumed" }
  | { action: "pay_renewal"; url: string };

/**
 * Starts a plan change requested from the dashboard (billing.manage already
 * checked). Upgrades use the saved card when there is one; otherwise, and for
 * new subscriptions, the user is sent to Paystack checkout.
 */
export async function changePlan(admin: DbClient, p: { businessId: string; planCode: string; userId: string; email: string }, now = new Date()): Promise<ChangePlanResult> {
  const sub = await loadSubscription(admin, p.businessId);
  const { data: target } = await admin
    .from("subscription_plans")
    .select("id, code, name, price_minor, currency, interval")
    .eq("code", p.planCode)
    .eq("is_active", true)
    .eq("is_public", true)
    .maybeSingle();
  if (!target) throw new BillingError("That plan isn't available.");
  if (target.price_minor <= 0) throw new BillingError("That plan can't be purchased online.");

  const change = planChange(stateOf(sub), { code: target.code, priceMinor: target.price_minor });
  const email = sub.billing_email ?? p.email;
  if (!sub.billing_email) await admin.from("subscriptions").update({ billing_email: email }).eq("id", sub.id);
  const audit = (action: string, metadata: Record<string, unknown>) =>
    admin.from("audit_logs").insert({ business_id: p.businessId, actor_user_id: p.userId, action, entity_type: "subscription", entity_id: sub.id, metadata: metadata as Json });

  switch (change) {
    case "same":
      throw new BillingError(`You're already on ${target.name}.`);
    case "resume": {
      await setSchedule(admin, p.businessId, { cancelAtPeriodEnd: false, pendingPlanCode: null });
      await audit("billing.resumed", { plan: target.code });
      return { action: "resumed" };
    }
    case "downgrade": {
      await setSchedule(admin, p.businessId, { cancelAtPeriodEnd: false, pendingPlanCode: target.code });
      await audit("billing.downgrade_scheduled", { from: sub.plan.code, to: target.code });
      return { action: "scheduled_downgrade", planName: target.name, effective: sub.current_period_end };
    }
    case "pay_renewal": {
      const url = await outstandingRenewalLink(admin, sub, email);
      return { action: "pay_renewal", url };
    }
    case "upgrade": {
      const amount = prorateUpgrade({
        fromPriceMinor: sub.plan.price_minor,
        toPriceMinor: target.price_minor,
        periodStart: new Date(sub.current_period_start),
        periodEnd: new Date(sub.current_period_end),
        now,
      });
      const invoice = await createInvoice(admin, { sub, plan: target, kind: "upgrade", amountMinor: amount, userId: p.userId });
      await audit("billing.upgrade_started", { from: sub.plan.code, to: target.code, amount_minor: amount });
      const saved = await savedAuthorization(admin, p.businessId);
      if (saved) {
        const ok = await chargeSavedCard(admin, invoice, saved, p.businessId);
        if (ok) return { action: "charged", planName: target.name };
      }
      return { action: "checkout", url: await checkoutLink(admin, invoice, email, p.businessId) };
    }
    case "subscribe": {
      const invoice = await createInvoice(admin, { sub, plan: target, kind: "subscribe", amountMinor: target.price_minor, userId: p.userId });
      await audit("billing.checkout_started", { plan: target.code });
      return { action: "checkout", url: await checkoutLink(admin, invoice, email, p.businessId) };
    }
  }
}

async function setSchedule(admin: DbClient, businessId: string, s: { cancelAtPeriodEnd: boolean; pendingPlanCode: string | null }) {
  const { error } = await admin.rpc("set_subscription_schedule", {
    p_business_id: businessId,
    p_cancel_at_period_end: s.cancelAtPeriodEnd,
    p_pending_plan_code: s.pendingPlanCode as string,
  });
  if (error) throw error.code === "P0002" ? new BillingError("There's no active paid subscription to change.") : error;
}

export async function cancelAtPeriodEnd(admin: DbClient, p: { businessId: string; userId: string }) {
  await setSchedule(admin, p.businessId, { cancelAtPeriodEnd: true, pendingPlanCode: null });
  await admin.from("audit_logs").insert({ business_id: p.businessId, actor_user_id: p.userId, action: "billing.cancel_scheduled" });
}

export async function clearScheduledChange(admin: DbClient, p: { businessId: string; userId: string }) {
  await setSchedule(admin, p.businessId, { cancelAtPeriodEnd: false, pendingPlanCode: null });
  await admin.from("audit_logs").insert({ business_id: p.businessId, actor_user_id: p.userId, action: "billing.schedule_cleared" });
}

/** Charges a saved card for an invoice; true if it was paid and applied. */
async function chargeSavedCard(admin: DbClient, invoice: { id: string; reference: string; amount_minor: number; currency: string }, saved: { code: string; email: string }, businessId: string) {
  const { client } = platformPaystack();
  try {
    await client.chargeAuthorization({
      authorizationCode: saved.code,
      email: saved.email,
      amountMinor: invoice.amount_minor,
      currency: invoice.currency,
      reference: invoice.reference,
      metadata: { sellflow_billing: true, business_id: businessId, invoice_id: invoice.id },
    });
  } catch (err) {
    logger.warn("billing.charge_authorization_failed", { business_id: businessId, invoice_id: invoice.id, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
  const res = await confirmBillingPayment(admin, invoice.reference);
  return res.outcome === "applied" || res.outcome === "already_paid";
}

export type ConfirmResult =
  | { outcome: "applied" | "already_paid"; kind: string; planName?: string; businessId: string }
  | { outcome: "void_paid"; businessId: string }
  | { outcome: "pending" | "failed"; reason: string; businessId?: string }
  | { outcome: "unknown" };

/**
 * Verifies a billing transaction with Paystack (never trusting the browser or
 * the webhook body) and applies it. Idempotent.
 */
export async function confirmBillingPayment(admin: DbClient, reference: string, opts: { businessId?: string } = {}): Promise<ConfirmResult> {
  if (!reference.startsWith(REFERENCE_PREFIX)) return { outcome: "unknown" };
  const { data: invoice } = await admin.from("billing_invoices").select("id, business_id, status, kind").eq("reference", reference).maybeSingle();
  if (!invoice || (opts.businessId && invoice.business_id !== opts.businessId)) return { outcome: "unknown" };
  if (invoice.status === "paid") return { outcome: "already_paid", kind: invoice.kind, businessId: invoice.business_id };

  const { client } = platformPaystack();
  let tx: PaystackTransaction;
  try {
    tx = await client.verify(reference);
  } catch (err) {
    if (err instanceof PaystackError && err.status === 400) return { outcome: "pending", reason: "Paystack has no completed payment for this checkout yet.", businessId: invoice.business_id };
    throw err;
  }
  if (tx.status !== "success") {
    if (tx.status === "failed" && invoice.kind !== "renewal") {
      await admin.from("billing_invoices").update({ status: "failed", failure_reason: tx.gateway_response?.slice(0, 500) ?? "failed" }).eq("id", invoice.id).eq("status", "pending");
    }
    return { outcome: tx.status === "failed" ? "failed" : "pending", reason: tx.gateway_response ?? tx.status, businessId: invoice.business_id };
  }

  const a = tx.authorization;
  const card = a?.reusable && a.last4 ? { brand: a.brand ?? a.card_type ?? "card", last4: a.last4, exp: a.exp_month && a.exp_year ? `${a.exp_month}/${String(a.exp_year).slice(-2)}` : null } : null;
  const { data, error } = await admin.rpc("apply_billing_payment", {
    p_reference: reference,
    p_amount_minor: tx.amount,
    p_currency: tx.currency,
    p_paid_at: tx.paid_at ?? new Date().toISOString(),
    p_card: card as unknown as Json,
    p_provider_response: { id: tx.id, status: tx.status, channel: tx.channel, gateway_response: tx.gateway_response } as Json,
  });
  if (error) {
    logger.error("billing.apply_failed", error, { business_id: invoice.business_id, invoice_id: invoice.id });
    await admin.from("billing_invoices").update({ failure_reason: error.message.slice(0, 500) }).eq("id", invoice.id);
    return { outcome: "failed", reason: "The payment didn't match the invoice. Our team has been notified.", businessId: invoice.business_id };
  }
  const result = data as { outcome: "applied" | "already_paid" | "void_paid"; kind: string; plan_name?: string };

  if (result.outcome !== "already_paid") {
    const email = tx.customer?.email ?? (await admin.from("subscriptions").select("billing_email").eq("business_id", invoice.business_id).single()).data?.billing_email ?? "";
    if (email) await saveAuthorization(admin, invoice.business_id, tx, email);
  }
  if (result.outcome === "applied") {
    await notifyOwners(admin, invoice.business_id, {
      type: "billing.paid",
      title: result.kind === "renewal" ? "Subscription renewed" : `You're on ${result.plan_name}`,
      body: `Payment of ${formatMoney(tx.amount, tx.currency)} received. Thank you!`,
    });
    logger.info("billing.invoice_paid", { business_id: invoice.business_id, invoice_id: invoice.id, kind: result.kind });
  }
  if (result.outcome === "void_paid") return { outcome: "void_paid", businessId: invoice.business_id };
  return { outcome: result.outcome, kind: result.kind, planName: result.plan_name, businessId: invoice.business_id };
}

/** Webhook from SellFlow's own Paystack account. */
export async function handleBillingWebhook(admin: DbClient, p: { rawBody: string; signature: string | null; requestId: string }): Promise<{ status: number; handled: string }> {
  const { key } = platformPaystack();
  if (!verifyPaystackSignature(p.rawBody, p.signature, key)) return { status: 401, handled: "invalid signature" };
  let evt: { event?: string; data?: { id?: number; reference?: string } };
  try {
    evt = JSON.parse(p.rawBody);
  } catch {
    return { status: 400, handled: "invalid json" };
  }
  const reference = String(evt.data?.reference ?? "").slice(0, 200);
  if (evt.event !== "charge.success" || !reference.startsWith(REFERENCE_PREFIX)) return { status: 200, handled: "ignored" };

  // Record once (billing_events.provider_event_key is unique).
  const { error } = await admin
    .from("billing_events")
    .insert({ type: "paystack.charge.success", provider_event_key: `paystack:charge.success:${evt.data?.id ?? reference}`, payload: JSON.parse(p.rawBody) as Json });
  if (error && error.code !== "23505") throw error;

  const res = await confirmBillingPayment(admin, reference);
  logger.info("billing.webhook", { request_id: p.requestId, outcome: res.outcome });
  return { status: 200, handled: res.outcome };
}

async function outstandingRenewalLink(admin: DbClient, sub: SubRow, email: string) {
  const { data: inv } = await admin
    .from("billing_invoices")
    .select("id, reference, amount_minor, currency, authorization_url")
    .eq("subscription_id", sub.id)
    .eq("kind", "renewal")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!inv) throw new BillingError("There's nothing to pay right now.");
  if (inv.authorization_url) return inv.authorization_url;
  return checkoutLink(admin, inv, email, sub.business_id);
}

export type RenewalResult = { subscriptionId: string; outcome: "renewed" | "failed" | "awaiting_payment" | "skipped"; reason?: string };

/**
 * Renews subscriptions whose period has ended: the next period's invoice (at
 * the scheduled plan, if a downgrade is pending) is charged to the saved card.
 * Without a card, or when the charge fails, the subscription goes past_due and
 * the owners get a payment link; retried daily within the grace period.
 */
export async function processRenewals(admin: DbClient, now = new Date()): Promise<RenewalResult[]> {
  if (!isBillingConfigured()) return [];
  const { data: due, error } = await admin
    .from("subscriptions")
    .select("business_id, next_renewal_attempt_at")
    .in("status", ["active", "past_due"])
    .eq("cancel_at_period_end", false)
    .lte("current_period_end", now.toISOString())
    .lt("renewal_attempts", RENEWAL_MAX_ATTEMPTS)
    .limit(200);
  if (error) throw error;

  const results: RenewalResult[] = [];
  for (const row of due ?? []) {
    if (row.next_renewal_attempt_at && new Date(row.next_renewal_attempt_at) > now) continue;
    try {
      results.push(await renewOne(admin, row.business_id, now));
    } catch (err) {
      logger.error("billing.renewal_error", err, { business_id: row.business_id });
    }
  }
  return results;
}

async function renewOne(admin: DbClient, businessId: string, now: Date): Promise<RenewalResult> {
  const sub = await loadSubscription(admin, businessId);
  // Suspended by the platform: never charge; the grace period runs out normally.
  const { data: biz } = await admin.from("businesses").select("status").eq("id", businessId).single();
  if (biz?.status !== "active") return { subscriptionId: sub.id, outcome: "skipped", reason: `business ${biz?.status ?? "missing"}` };
  const planId = sub.pending_plan_id ?? sub.plan_id;
  const { data: plan } = await admin.from("subscription_plans").select("id, code, name, price_minor, currency, interval").eq("id", planId).single();
  if (!plan) return { subscriptionId: sub.id, outcome: "skipped", reason: "plan missing" };

  const periodStart = new Date(sub.current_period_end);
  const periodEnd = addPlanInterval(periodStart, plan.interval);

  // One renewal invoice per period (unique index); reuse it across retries.
  let { data: invoice } = await admin
    .from("billing_invoices")
    .select("id, reference, amount_minor, currency, status")
    .eq("subscription_id", sub.id)
    .eq("kind", "renewal")
    .eq("period_start", periodStart.toISOString())
    .neq("status", "void")
    .maybeSingle();
  if (invoice?.status === "paid") return { subscriptionId: sub.id, outcome: "renewed" };
  if (!invoice) {
    invoice = { ...(await createInvoice(admin, { sub, plan, kind: "renewal", amountMinor: plan.price_minor, periodStart, periodEnd })), status: "pending" as const };
  }
  const inv = invoice!;

  const saved = await savedAuthorization(admin, businessId);
  if (saved) {
    // A retry needs a fresh Paystack reference: the previous one was used by the failed charge.
    if (sub.renewal_attempts > 0) {
      const reference = newReference();
      await admin.from("billing_invoices").update({ reference, authorization_url: null }).eq("id", inv.id).eq("status", "pending");
      inv.reference = reference;
    }
    if (await chargeSavedCard(admin, inv, saved, businessId)) return { subscriptionId: sub.id, outcome: "renewed" };
  }

  const email = sub.billing_email ?? saved?.email;
  let link: string | null = null;
  if (email) {
    try {
      const reference = newReference();
      await admin.from("billing_invoices").update({ reference }).eq("id", inv.id).eq("status", "pending");
      link = await checkoutLink(admin, { ...inv, reference }, email, businessId);
    } catch (err) {
      logger.warn("billing.renewal_link_failed", { business_id: businessId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const reason = saved ? "The saved card was declined." : "No saved card on file.";
  await admin.rpc("mark_renewal_failed", { p_invoice_id: inv.id, p_reason: reason, p_next_attempt: new Date(now.getTime() + RENEWAL_RETRY_MS).toISOString() });
  await notifyOwners(admin, businessId, {
    type: "billing.payment_needed",
    title: "Payment needed to keep SellFlow running",
    body: `${reason} Pay ${formatMoney(inv.amount_minor, inv.currency)} for ${plan.name} within 3 days to avoid interruption.`,
    data: link ? { url: link } : {},
  });
  return { subscriptionId: sub.id, outcome: saved ? "failed" : "awaiting_payment", reason };
}

/** Hourly: trials/grace periods/cancellations that ran out. */
export async function advanceSubscriptionStates(admin: DbClient) {
  const { data, error } = await admin.rpc("advance_subscription_states", {});
  if (error) throw error;
  return data as { trials_expired: number; cancelled: number; expired: number };
}

const ALERT_METRICS = { monthly_ai_conversations: "AI conversations", messages: "messages", orders: "orders" } as const;

/**
 * Hourly: tells the team when a monthly allowance reaches 80% and 100%
 * (once per metric, level and month).
 */
export async function sendUsageAlerts(admin: DbClient, now = new Date()) {
  const period = usagePeriodStart(now).toISOString();
  const { data: rows } = await admin.from("usage_records").select("business_id").eq("period_start", period.slice(0, 10)).in("metric", ["messages", "monthly_ai_conversations"]);
  const businesses = Array.from(new Set((rows ?? []).map((r) => r.business_id)));
  let sent = 0;
  for (const businessId of businesses) {
    const plan = await getPlan(admin, businessId);
    if (!plan || !isSubscriptionUsable(plan.status)) continue;
    const { data: already } = await admin.from("notifications").select("data").eq("business_id", businessId).eq("type", "usage.alert").gte("created_at", period);
    const done = new Set((already ?? []).map((n) => `${(n.data as { metric?: string }).metric}:${(n.data as { level?: number }).level}`));
    for (const metric of Object.keys(ALERT_METRICS) as (keyof typeof ALERT_METRICS)[]) {
      const limit = plan.limits[metric];
      const used = await currentUsage(admin, businessId, metric, now);
      const level = usageAlertLevel(used, limit);
      if (!level || done.has(`${metric}:${level}`)) continue;
      await notifyOwners(admin, businessId, {
        type: "usage.alert",
        title: level === 1 ? `You've used all your ${ALERT_METRICS[metric]} this month` : `You've used 80% of your ${ALERT_METRICS[metric]} this month`,
        body:
          level === 1
            ? `${used.toLocaleString()} of ${limit!.toLocaleString()} on ${plan.name}. ${metric === "orders" ? "The AI can't take new orders" : "The AI hands conversations to your team"} until next month — upgrade in Billing to continue.`
            : `${used.toLocaleString()} of ${limit!.toLocaleString()} on ${plan.name}. Consider upgrading before you run out.`,
        data: { metric, level, used, limit },
      });
      sent++;
    }
  }
  return { sent };
}

async function notifyOwners(admin: DbClient, businessId: string, n: { type: string; title: string; body: string; data?: Record<string, unknown> }) {
  await admin.from("notifications").insert({ business_id: businessId, type: n.type, title: n.title, body: n.body, data: (n.data ?? {}) as Json });
}

export async function listInvoices(db: DbClient, businessId: string) {
  const { data } = await db
    .from("billing_invoices")
    .select("id, kind, status, amount_minor, currency, reference, authorization_url, paid_at, created_at, period_start, period_end, failure_reason, plan:subscription_plans(name)")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(24);
  return data ?? [];
}
