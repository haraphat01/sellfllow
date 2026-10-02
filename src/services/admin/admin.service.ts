import "server-only";

import type { DbClient } from "@/lib/supabase/types";
import type { Json } from "@/db/types/database";
import { daysAgoIso } from "@/lib/time";

/**
 * Platform administration. Every function takes the service-role client and
 * must only be called after `authorizePlatformAdmin()` / `requirePlatformAdmin()`.
 * Every change is written to audit_logs (actor_type 'admin').
 */

export class AdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminError";
  }
}

export type PlatformStats = {
  businesses_total: number;
  businesses_active: number;
  businesses_suspended: number;
  businesses_new: number;
  subscriptions: Record<string, number>;
  paying: number;
  complimentary: number;
  paying_by_plan: Record<string, number>;
  mrr_minor: number;
  sellflow_revenue_minor: number;
  churned: number;
  trials_expired: number;
  renewals_failed: number;
  messages: number;
  messages_failed: number;
  ai_conversations_this_month: number;
  ai_requests: number;
  orders: number;
  orders_paid: number;
  payment_volume: Record<string, number>;
  errors: { whatsapp_events_failed: number; payment_events_failed: number; follow_ups_failed: number; ai_handoffs_on_error: number };
  whatsapp_accounts: Record<string, number>;
  signups_daily: { day: string; n: number }[];
};

export async function getPlatformStats(admin: DbClient, days = 30, now = new Date()) {
  const from = new Date(now.getTime() - days * 86_400_000);
  const { data, error } = await admin.rpc("admin_platform_stats", { p_from: from.toISOString(), p_to: now.toISOString() });
  if (error) throw error;
  const s = data as unknown as PlatformStats;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    ...s,
    mrr_minor: n(s.mrr_minor),
    sellflow_revenue_minor: n(s.sellflow_revenue_minor),
    ai_conversations_this_month: n(s.ai_conversations_this_month),
    payment_volume: Object.fromEntries(Object.entries(s.payment_volume ?? {}).map(([k, v]) => [k, n(v)])),
    // Share of the paying base (at the end of the window, plus those lost) that churned.
    churnRate: s.paying + s.churned > 0 ? s.churned / (s.paying + s.churned) : null,
  };
}

async function audit(admin: DbClient, p: { businessId: string | null; adminId: string; action: string; entityType?: string; entityId?: string | null; metadata?: Record<string, unknown> }) {
  const { error } = await admin.from("audit_logs").insert({
    business_id: p.businessId,
    actor_user_id: p.adminId,
    actor_type: "admin",
    action: p.action,
    entity_type: p.entityType ?? null,
    entity_id: p.entityId ?? null,
    metadata: (p.metadata ?? {}) as Json,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Businesses
// ---------------------------------------------------------------------------

export async function searchBusinesses(admin: DbClient, opts: { q?: string; status?: string; page?: number }) {
  const pageSize = 25;
  const page = Math.max(1, opts.page ?? 1);
  let query = admin
    .from("businesses")
    .select("id, name, slug, status, country, created_at, subscriptions(status, is_complimentary, current_period_end, plan:subscription_plans!subscriptions_plan_id_fkey(name, code))", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  const q = opts.q?.trim().slice(0, 100);
  if (q) {
    // Match by business name/slug, or by a member's email.
    const safe = q.replace(/[%_,()]/g, " ");
    const { data: people } = await admin.from("profiles").select("id").ilike("email", `%${safe}%`).limit(50);
    const { data: memberships } = people?.length ? await admin.from("business_members").select("business_id").in("user_id", people.map((p) => p.id)) : { data: [] };
    const ids = Array.from(new Set((memberships ?? []).map((m) => m.business_id)));
    const isUuid = /^[0-9a-f-]{36}$/i.test(q);
    const ors = [`name.ilike.%${safe}%`, `slug.ilike.%${safe}%`];
    if (ids.length) ors.push(`id.in.(${ids.join(",")})`);
    if (isUuid) ors.push(`id.eq.${q}`);
    query = query.or(ors.join(","));
  }
  if (opts.status === "active" || opts.status === "suspended" || opts.status === "closed") query = query.eq("status", opts.status);

  const { data, count, error } = await query;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0, page, pageSize };
}

export async function getBusinessDetail(admin: DbClient, businessId: string) {
  const since = daysAgoIso(30);
  const [business, sub, members, accounts, payout, audits, failedMessages, counts] = await Promise.all([
    admin.from("businesses").select("*").eq("id", businessId).maybeSingle(),
    admin
      .from("subscriptions")
      .select("*, plan:subscription_plans!subscriptions_plan_id_fkey(code, name, price_minor, currency, limits), pending:subscription_plans!subscriptions_pending_plan_id_fkey(name)")
      .eq("business_id", businessId)
      .maybeSingle(),
    admin.from("business_members").select("user_id, role, status, created_at").eq("business_id", businessId),
    admin.from("whatsapp_accounts").select("id, display_phone_number, verified_name, status, quality_rating, last_error, connected_at").eq("business_id", businessId),
    admin.from("payout_accounts").select("bank_name, account_number_last4, account_name, subaccount_code, status, updated_at").eq("business_id", businessId).maybeSingle(),
    admin.from("audit_logs").select("id, action, actor_type, actor_user_id, metadata, created_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(25),
    admin.from("messages").select("id, error, created_at, sender").eq("business_id", businessId).eq("status", "failed").gte("created_at", since).order("created_at", { ascending: false }).limit(10),
    Promise.all([
      admin.from("customers").select("id", { count: "exact", head: true }).eq("business_id", businessId),
      admin.from("conversations").select("id", { count: "exact", head: true }).eq("business_id", businessId),
      admin.from("orders").select("id", { count: "exact", head: true }).eq("business_id", businessId),
      admin.from("products").select("id", { count: "exact", head: true }).eq("business_id", businessId).neq("status", "archived"),
    ]),
  ]);
  if (!business.data) return null;

  const userIds = (members.data ?? []).map((m) => m.user_id);
  const { data: profiles } = userIds.length ? await admin.from("profiles").select("id, email, full_name").in("id", userIds) : { data: [] };
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  return {
    business: business.data,
    subscription: sub.data,
    members: (members.data ?? []).map((m) => ({ ...m, email: byId.get(m.user_id)?.email ?? "", name: byId.get(m.user_id)?.full_name ?? null })),
    whatsappAccounts: accounts.data ?? [],
    payoutAccount: payout.data,
    audit: audits.data ?? [],
    failedMessages: failedMessages.data ?? [],
    counts: { customers: counts[0].count ?? 0, conversations: counts[1].count ?? 0, orders: counts[2].count ?? 0, products: counts[3].count ?? 0 },
  };
}

export async function setBusinessSuspended(admin: DbClient, p: { businessId: string; suspend: boolean; reason: string; adminId: string }) {
  const { data, error } = await admin
    .from("businesses")
    .update({ status: p.suspend ? "suspended" : "active", suspended_reason: p.suspend ? p.reason : null })
    .eq("id", p.businessId)
    .in("status", p.suspend ? ["active"] : ["suspended"])
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new AdminError(p.suspend ? "This business isn't active." : "This business isn't suspended.");
  await audit(admin, { businessId: p.businessId, adminId: p.adminId, action: p.suspend ? "admin.business_suspended" : "admin.business_reinstated", entityType: "business", entityId: p.businessId, metadata: { reason: p.reason } });
  await admin.from("notifications").insert({
    business_id: p.businessId,
    type: p.suspend ? "platform.suspended" : "platform.reinstated",
    title: p.suspend ? "Your business has been suspended" : "Your business has been reinstated",
    body: p.suspend ? `The AI assistant and automations are paused. Reason: ${p.reason}. Contact support to resolve this.` : "Everything is running again.",
  });
}

/**
 * Gives a business a plan for N days without payment (support, partners,
 * disputes). It is flagged complimentary (not revenue) and doesn't auto-renew.
 */
export async function grantPlan(admin: DbClient, p: { businessId: string; planCode: string; days: number; reason: string; adminId: string }, now = new Date()) {
  const { data: plan } = await admin.from("subscription_plans").select("id, name").eq("code", p.planCode).maybeSingle();
  if (!plan) throw new AdminError("Unknown plan.");
  const end = new Date(now.getTime() + p.days * 86_400_000);
  const { data: sub, error } = await admin
    .from("subscriptions")
    .update({
      plan_id: plan.id,
      status: "active",
      is_complimentary: true,
      current_period_start: now.toISOString(),
      current_period_end: end.toISOString(),
      cancel_at_period_end: true,
      cancelled_at: null,
      pending_plan_id: null,
      past_due_since: null,
      renewal_attempts: 0,
      next_renewal_attempt_at: null,
    })
    .eq("business_id", p.businessId)
    .select("id")
    .single();
  if (error) throw error;
  // Open checkouts would otherwise overwrite the grant when paid.
  await admin.from("billing_invoices").update({ status: "void", failure_reason: "replaced by admin grant" }).eq("subscription_id", sub.id).eq("status", "pending");
  await admin.from("billing_events").insert({ business_id: p.businessId, subscription_id: sub.id, type: "admin.plan_granted", payload: { plan: p.planCode, days: p.days, reason: p.reason, admin_id: p.adminId } });
  await audit(admin, { businessId: p.businessId, adminId: p.adminId, action: "admin.plan_granted", entityType: "subscription", entityId: sub.id, metadata: { plan: p.planCode, days: p.days, reason: p.reason, until: end.toISOString() } });
  return { planName: plan.name, until: end.toISOString() };
}

/** Extends (or restarts) a free trial. Not for businesses that already pay. */
export async function extendTrial(admin: DbClient, p: { businessId: string; days: number; reason: string; adminId: string }, now = new Date()) {
  const { data: sub } = await admin.from("subscriptions").select("id, status, trial_ends_at, is_complimentary").eq("business_id", p.businessId).single();
  if (!sub) throw new AdminError("No subscription.");
  if (sub.status === "active" || sub.status === "past_due") throw new AdminError("This business is on a paid or granted plan — grant a plan instead.");
  const from = Math.max(now.getTime(), sub.trial_ends_at ? new Date(sub.trial_ends_at).getTime() : 0);
  const end = new Date(from + p.days * 86_400_000).toISOString();
  const { error } = await admin
    .from("subscriptions")
    .update({ status: "trialing", trial_ends_at: end, current_period_end: end, cancelled_at: null, cancel_at_period_end: false })
    .eq("id", sub.id);
  if (error) throw error;
  await audit(admin, { businessId: p.businessId, adminId: p.adminId, action: "admin.trial_extended", entityType: "subscription", entityId: sub.id, metadata: { days: p.days, reason: p.reason, until: end } });
  return { until: end };
}

// ---------------------------------------------------------------------------
// Plans & platform settings
// ---------------------------------------------------------------------------

export async function listPlans(admin: DbClient) {
  const [{ data: plans }, { data: subs }] = await Promise.all([
    admin.from("subscription_plans").select("*").order("sort_order"),
    admin.from("subscriptions").select("plan_id, status"),
  ]);
  const counts = new Map<string, number>();
  for (const s of subs ?? []) if (s.status === "active" || s.status === "past_due" || s.status === "trialing") counts.set(s.plan_id, (counts.get(s.plan_id) ?? 0) + 1);
  return (plans ?? []).map((p) => ({ ...p, subscribers: counts.get(p.id) ?? 0 }));
}

type PlanInput = {
  code: string;
  name: string;
  description: string | null;
  price: number;
  interval: "monthly" | "annually";
  sort_order: number;
  is_active: boolean;
  is_public: boolean;
  limits: Record<string, number | null>;
  features: Record<string, boolean>;
};

/**
 * Creates or updates a plan. Price changes apply to renewals and new
 * checkouts; already-created invoices keep their amount. A plan in use can
 * be hidden or retired but never deleted.
 */
export async function savePlan(admin: DbClient, p: { plan: PlanInput; existingId: string | null; adminId: string }) {
  const row = {
    code: p.plan.code,
    name: p.plan.name,
    description: p.plan.description,
    price_minor: p.plan.price,
    interval: p.plan.interval,
    sort_order: p.plan.sort_order,
    is_active: p.plan.is_active,
    is_public: p.plan.is_public,
    limits: p.plan.limits as Json,
    features: p.plan.features as Json,
  };
  let before: Record<string, unknown> | null = null;
  if (p.existingId) {
    const { data: old } = await admin.from("subscription_plans").select("code, price_minor, limits, features, is_active, is_public").eq("id", p.existingId).single();
    before = old;
    if (old && old.code !== row.code) throw new AdminError("A plan's code can't be changed.");
    const { error } = await admin.from("subscription_plans").update(row).eq("id", p.existingId);
    if (error) throw error;
  } else {
    const { error } = await admin.from("subscription_plans").insert(row);
    if (error) throw error.code === "23505" ? new AdminError("A plan with that code already exists.") : error;
  }
  await audit(admin, { businessId: null, adminId: p.adminId, action: p.existingId ? "admin.plan_updated" : "admin.plan_created", entityType: "subscription_plan", entityId: p.existingId, metadata: { code: row.code, before, after: row } });
}

export async function getPlatformSettings(admin: DbClient) {
  const { data } = await admin.from("platform_settings").select("key, value").in("key", ["billing", "payments"]);
  const billing = (data?.find((r) => r.key === "billing")?.value ?? {}) as { trial_days?: number };
  const payments = (data?.find((r) => r.key === "payments")?.value ?? {}) as { commission_percent?: number; commission_flat_minor?: number };
  return {
    trial_days: billing.trial_days ?? 14,
    commission_percent: Number(payments.commission_percent ?? 0),
    commission_flat_minor: Number(payments.commission_flat_minor ?? 0),
  };
}

/** Trial length and the per-sale fee on bank-payout (subaccount) payments. Applies to new payment links only. */
export async function savePlatformSettings(admin: DbClient, p: { trialDays: number; commissionPercent: number; commissionFlatMinor: number; adminId: string }) {
  const current = await getPlatformSettings(admin);
  const at = new Date().toISOString();
  const { error } = await admin.from("platform_settings").upsert([
    { key: "billing", value: { trial_days: p.trialDays }, updated_by: p.adminId, updated_at: at },
    { key: "payments", value: { commission_percent: p.commissionPercent, commission_flat_minor: p.commissionFlatMinor }, updated_by: p.adminId, updated_at: at },
  ]);
  if (error) throw error;
  await audit(admin, {
    businessId: null,
    adminId: p.adminId,
    action: "admin.settings_updated",
    metadata: {
      trial_days: { from: current.trial_days, to: p.trialDays },
      commission_percent: { from: current.commission_percent, to: p.commissionPercent },
      commission_flat_minor: { from: current.commission_flat_minor, to: p.commissionFlatMinor },
    },
  });
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export async function listAuditLogs(admin: DbClient, opts: { actor?: string; action?: string; page?: number }) {
  const pageSize = 50;
  const page = Math.max(1, opts.page ?? 1);
  let q = admin
    .from("audit_logs")
    .select("id, business_id, actor_type, actor_user_id, action, entity_type, metadata, created_at, businesses(name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (opts.actor && ["user", "ai", "system", "webhook", "admin"].includes(opts.actor)) q = q.eq("actor_type", opts.actor);
  if (opts.action) q = q.ilike("action", `${opts.action.replace(/[%_]/g, "")}%`);
  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0, page, pageSize };
}

/** Recent processing failures across the platform (webhooks, payments, follow-ups, sends). */
export async function listFailures(admin: DbClient, days = 7) {
  const since = daysAgoIso(days);
  const [wa, pay, fu, msgs, renewals] = await Promise.all([
    admin
      .from("whatsapp_events")
      .select("id, business_id, event_type, status, attempts, error, received_at")
      .gte("received_at", since)
      .or("status.eq.failed,and(status.eq.ignored,attempts.gt.0)")
      .order("received_at", { ascending: false })
      .limit(30),
    admin.from("payment_events").select("id, business_id, event_type, status, error, received_at").eq("status", "failed").gte("received_at", since).order("received_at", { ascending: false }).limit(30),
    admin.from("follow_ups").select("id, business_id, cancel_reason, updated_at").eq("status", "failed").gte("updated_at", since).order("updated_at", { ascending: false }).limit(30),
    admin.from("messages").select("id, business_id, sender, error, created_at").eq("status", "failed").gte("created_at", since).order("created_at", { ascending: false }).limit(30),
    admin.from("billing_events").select("id, business_id, type, payload, created_at").eq("type", "renewal.failed").gte("created_at", since).order("created_at", { ascending: false }).limit(30),
  ]);
  const rows = [
    ...(wa.data ?? []).map((r) => ({ id: r.id, source: "WhatsApp webhook", businessId: r.business_id, detail: `${r.event_type} · ${r.attempts} attempt(s)`, error: r.error, at: r.received_at })),
    ...(pay.data ?? []).map((r) => ({ id: r.id, source: "Paystack webhook", businessId: r.business_id, detail: r.event_type, error: r.error, at: r.received_at })),
    ...(fu.data ?? []).map((r) => ({ id: r.id, source: "Follow-up", businessId: r.business_id, detail: "send failed", error: r.cancel_reason, at: r.updated_at })),
    ...(msgs.data ?? []).map((r) => ({ id: r.id, source: "Outbound message", businessId: r.business_id, detail: r.sender, error: r.error, at: r.created_at })),
    ...(renewals.data ?? []).map((r) => ({ id: r.id, source: "Renewal", businessId: r.business_id, detail: "charge failed", error: String((r.payload as { reason?: string }).reason ?? ""), at: r.created_at })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const ids = Array.from(new Set(rows.map((r) => r.businessId).filter(Boolean))) as string[];
  const { data: names } = ids.length ? await admin.from("businesses").select("id, name").in("id", ids) : { data: [] };
  const nameOf = new Map((names ?? []).map((b) => [b.id, b.name]));
  return rows.slice(0, 100).map((r) => ({ ...r, businessName: r.businessId ? (nameOf.get(r.businessId) ?? null) : null }));
}
