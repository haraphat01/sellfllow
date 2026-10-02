import "server-only";

import type { DbClient } from "@/lib/supabase/types";

export type LimitMetric =
  | "monthly_ai_conversations"
  | "messages"
  | "customers"
  | "orders"
  | "campaigns"
  | "whatsapp_numbers"
  | "staff"
  | "products";

export class PlanLimitError extends Error {
  constructor(
    public metric: LimitMetric,
    public limit: number,
    message?: string,
  ) {
    super(message ?? `Your plan allows up to ${limit.toLocaleString()} ${metric.replaceAll("_", " ")}. Upgrade to add more.`);
    this.name = "PlanLimitError";
  }
}

export type PlanInfo = {
  code: string;
  name: string;
  status: string;
  limits: Partial<Record<LimitMetric, number | null>>;
  features: Record<string, boolean>;
};

export async function getPlan(db: DbClient, businessId: string): Promise<PlanInfo | null> {
  const { data } = await db
    .from("subscriptions")
    .select("status, plan:subscription_plans!subscriptions_plan_id_fkey(code, name, limits, features)")
    .eq("business_id", businessId)
    .maybeSingle();
  if (!data?.plan) return null;
  const plan = data.plan as unknown as { code: string; name: string; limits: PlanInfo["limits"]; features: PlanInfo["features"] };
  return { ...plan, status: data.status };
}

/** Subscriptions that may keep using the product. past_due is the grace period after a failed renewal. */
export function isSubscriptionUsable(status: string) {
  return status === "active" || status === "trialing" || status === "past_due";
}

/** First day of the current usage month (UTC), matching record_usage. */
export function usagePeriodStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Live usage for the metrics with monthly or total limits. Monthly metrics
 * come from usage_records (messages, AI conversations) or are counted
 * (orders this month); customers are a running total.
 */
export async function currentUsage(admin: DbClient, businessId: string, metric: "messages" | "monthly_ai_conversations" | "orders" | "customers", now = new Date()) {
  const since = usagePeriodStart(now).toISOString();
  if (metric === "orders") {
    const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("business_id", businessId).gte("created_at", since).neq("status", "draft");
    return count ?? 0;
  }
  if (metric === "customers") {
    const { count } = await admin.from("customers").select("id", { count: "exact", head: true }).eq("business_id", businessId);
    return count ?? 0;
  }
  const { data } = await admin.from("usage_records").select("quantity").eq("business_id", businessId).eq("metric", metric).eq("period_start", since.slice(0, 10)).maybeSingle();
  return Number(data?.quantity ?? 0);
}

/** Everything the plan limits, counted the same way it's enforced (for the Billing page). */
export async function usageSummary(admin: DbClient, businessId: string, now = new Date()): Promise<Record<LimitMetric, number>> {
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const [ai, messages, orders, customers, products, members, invites, numbers] = await Promise.all([
    currentUsage(admin, businessId, "monthly_ai_conversations", now),
    currentUsage(admin, businessId, "messages", now),
    currentUsage(admin, businessId, "orders", now),
    currentUsage(admin, businessId, "customers", now),
    count(admin.from("products").select("id", { count: "exact", head: true }).eq("business_id", businessId).neq("status", "archived")),
    count(admin.from("business_members").select("user_id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "active")),
    count(admin.from("business_invitations").select("id", { count: "exact", head: true }).eq("business_id", businessId).is("accepted_at", null).gt("expires_at", now.toISOString())),
    count(admin.from("whatsapp_accounts").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "connected")),
  ]);
  return {
    monthly_ai_conversations: ai,
    messages,
    orders,
    customers,
    products,
    staff: members + invites,
    whatsapp_numbers: numbers,
    campaigns: 0,
  };
}

/** True when the plan has a limit for `metric` and it's used up. */
export async function isOverLimit(admin: DbClient, businessId: string, plan: PlanInfo, metric: "messages" | "orders", now = new Date()) {
  const limit = plan.limits[metric];
  if (limit === null || limit === undefined) return false;
  return (await currentUsage(admin, businessId, metric, now)) >= limit;
}

/**
 * Throws PlanLimitError if adding `adding` items would exceed the plan's limit.
 * `current` is the live count (e.g. products, staff). null limit = unlimited.
 */
export async function assertWithinLimit(db: DbClient, businessId: string, metric: LimitMetric, current: number, adding = 1) {
  const plan = await getPlan(db, businessId);
  if (!plan || !isSubscriptionUsable(plan.status)) {
    throw new PlanLimitError(metric, 0, "Your subscription is not active. Update billing to continue.");
  }
  const limit = plan.limits[metric];
  if (limit === null || limit === undefined) return;
  if (current + adding > limit) throw new PlanLimitError(metric, limit);
}
