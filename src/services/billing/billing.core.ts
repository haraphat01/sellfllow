/**
 * Pure billing rules (no I/O): what a plan change means and what it costs.
 *
 *   trialing / expired / cancelled → subscribe: full price, new period from payment
 *   active, more expensive plan    → upgrade: now, prorated for the rest of the period
 *   active, cheaper plan           → downgrade: scheduled for the next renewal, no charge
 *   active, same plan              → resume (if cancelling) or nothing to do
 *   past_due                       → pay the outstanding renewal first
 */

export type SubscriptionState = {
  status: "trialing" | "active" | "past_due" | "cancelled" | "expired";
  planCode: string;
  priceMinor: number;
  cancelAtPeriodEnd: boolean;
  periodStart: Date;
  periodEnd: Date;
};

export type PlanChange = "subscribe" | "upgrade" | "downgrade" | "resume" | "same" | "pay_renewal";

export function planChange(current: SubscriptionState, target: { code: string; priceMinor: number }): PlanChange {
  if (current.status === "past_due") return "pay_renewal";
  if (current.status !== "active") return "subscribe";
  if (target.code === current.planCode) return current.cancelAtPeriodEnd ? "resume" : "same";
  return target.priceMinor > current.priceMinor ? "upgrade" : "downgrade";
}

/** Smallest amount we charge for an upgrade (₦100 in kobo), so tiny remainders still go through Paystack. */
export const MIN_CHARGE_MINOR = 10_000;

/** Price difference for the unused part of the current period, rounded up to whole naira. */
export function prorateUpgrade(p: { fromPriceMinor: number; toPriceMinor: number; periodStart: Date; periodEnd: Date; now: Date }): number {
  const total = p.periodEnd.getTime() - p.periodStart.getTime();
  const remaining = Math.min(Math.max(p.periodEnd.getTime() - p.now.getTime(), 0), total);
  if (total <= 0 || p.toPriceMinor <= p.fromPriceMinor) return 0;
  const raw = ((p.toPriceMinor - p.fromPriceMinor) * remaining) / total;
  return Math.max(Math.ceil(raw / 100) * 100, MIN_CHARGE_MINOR);
}

/** Retry schedule for failed renewals: daily, three attempts, inside the grace period. */
export const RENEWAL_MAX_ATTEMPTS = 3;
export const RENEWAL_RETRY_MS = 24 * 60 * 60 * 1000;

/** Adds one billing interval like Postgres does (31 Jan + 1 month = 28/29 Feb). */
export function addPlanInterval(start: Date, interval: string): Date {
  const months = interval === "annually" ? 12 : 1;
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const d = new Date(start);
  d.setUTCFullYear(y, m, Math.min(start.getUTCDate(), lastDay));
  return d;
}

/** Usage alert thresholds, as fractions of the limit. */
export const USAGE_ALERT_LEVELS = [0.8, 1] as const;

export function usageAlertLevel(used: number, limit: number | null | undefined): 0.8 | 1 | null {
  if (!limit) return null;
  const ratio = used / limit;
  return ratio >= 1 ? 1 : ratio >= 0.8 ? 0.8 : null;
}
