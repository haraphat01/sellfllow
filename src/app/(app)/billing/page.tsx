import type { Metadata } from "next";
import { AlertTriangle, Check, CreditCard } from "lucide-react";

import { ChoosePlanButton, SimpleAction } from "@/components/billing/plan-actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { requireBusinessContext } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { daysUntil } from "@/lib/time";
import { planChange, prorateUpgrade, type SubscriptionState } from "@/services/billing/billing.core";
import { isBillingConfigured, listInvoices } from "@/services/billing/billing.service";
import { usageSummary, type LimitMetric } from "@/services/billing/limits";

import { cancelSubscriptionAction, changePlanAction, clearScheduledChangeAction, removeCardAction } from "./actions";

export const metadata: Metadata = { title: "Billing" };

const METRICS: { key: LimitMetric; label: string; monthly: boolean }[] = [
  { key: "monthly_ai_conversations", label: "AI conversations", monthly: true },
  { key: "messages", label: "Messages", monthly: true },
  { key: "orders", label: "Orders", monthly: true },
  { key: "customers", label: "Customers", monthly: false },
  { key: "products", label: "Products", monthly: false },
  { key: "staff", label: "Team members (incl. invites)", monthly: false },
  { key: "whatsapp_numbers", label: "WhatsApp numbers", monthly: false },
];

const FEATURES: Record<string, string> = {
  follow_ups: "Abandoned-lead follow-ups",
  campaigns: "Campaigns",
  advanced_analytics: "Trends, funnel & top products",
  api: "API access",
  priority_support: "Priority support",
};

const STATUS: Record<string, { label: string; variant: "success" | "signal" | "warning" | "destructive" | "secondary" }> = {
  trialing: { label: "Free trial", variant: "signal" },
  active: { label: "Active", variant: "success" },
  past_due: { label: "Payment due", variant: "warning" },
  cancelled: { label: "Cancelled", variant: "destructive" },
  expired: { label: "Expired", variant: "destructive" },
};

const KIND: Record<string, string> = { subscribe: "Subscription", upgrade: "Upgrade (prorated)", renewal: "Renewal" };

type Plan = { id: string; code: string; name: string; description: string | null; price_minor: number; currency: string; interval: string; limits: Record<string, number | null>; features: Record<string, boolean> };

export default async function BillingPage() {
  const ctx = await requireBusinessContext();
  const db = await createClient();
  const admin = createAdminClient();
  const canManage = ctx.can("billing.manage");
  const now = new Date();

  const [{ data: sub }, { data: plans }, usage, invoices] = await Promise.all([
    db
      .from("subscriptions")
      .select("*, plan:subscription_plans!subscriptions_plan_id_fkey(*), pending:subscription_plans!subscriptions_pending_plan_id_fkey(name, price_minor, currency)")
      .eq("business_id", ctx.business.id)
      .maybeSingle(),
    db.from("subscription_plans").select("*").eq("is_active", true).eq("is_public", true).order("sort_order"),
    usageSummary(admin, ctx.business.id, now),
    canManage ? listInvoices(db, ctx.business.id) : Promise.resolve([]),
  ]);
  if (!sub) return <p className="text-sm text-muted-foreground">No subscription found for this business.</p>;

  const plan = sub.plan as unknown as Plan;
  const pending = sub.pending as unknown as { name: string; price_minor: number; currency: string } | null;
  const state: SubscriptionState = {
    status: sub.status,
    planCode: plan.code,
    priceMinor: plan.price_minor,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    periodStart: new Date(sub.current_period_start),
    periodEnd: new Date(sub.current_period_end),
  };
  const status = STATUS[sub.status];
  const trialDaysLeft = sub.status === "trialing" && sub.trial_ends_at ? daysUntil(sub.trial_ends_at, now) : null;
  const billingReady = isBillingConfigured();
  const outstanding = invoices.find((i) => i.status === "pending" && i.kind === "renewal" && i.authorization_url);

  return (
    <>
      <PageHeader title="Billing" description="Your SellFlow plan, usage this month and invoices. Payments are processed securely by Paystack." />

      {sub.status === "past_due" && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/50 bg-warning/10 p-4 text-sm">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4" /> We couldn’t renew your subscription. Everything keeps working for 3 days from the first failed attempt — pay now to avoid interruption.
          </span>
          {canManage && outstanding?.authorization_url && (
            <a href={outstanding.authorization_url} className="font-medium text-primary hover:underline">
              Pay {formatMoney(outstanding.amount_minor, outstanding.currency)} →
            </a>
          )}
        </div>
      )}
      {(sub.status === "expired" || sub.status === "cancelled") && (
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="size-4" /> Your {sub.status === "expired" ? (sub.trial_ends_at && !sub.card_last4 ? "trial has ended" : "subscription has expired") : "subscription was cancelled"}. The AI assistant and
          automations are paused — choose a plan to turn them back on. Your data is kept.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <section className="rounded-xl border bg-card p-6">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">Current plan</div>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold">{plan.name}</span>
            {sub.status !== "trialing" && (
              <span className="tabular text-sm text-muted-foreground">
                {formatMoney(plan.price_minor, plan.currency)}/{plan.interval === "annually" ? "yr" : "mo"}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {trialDaysLeft !== null
              ? `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left in your free trial (ends ${formatDate(sub.trial_ends_at!)})`
              : sub.status === "active" && sub.cancel_at_period_end
                ? `Ends on ${formatDate(sub.current_period_end)} — it won’t renew`
                : sub.status === "active" || sub.status === "past_due"
                  ? `Renews on ${formatDate(sub.current_period_end)}`
                  : `Ended ${formatDate(sub.cancelled_at ?? sub.current_period_end)}`}
          </p>
          {pending && sub.status === "active" && (
            <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm">
              Switching to <strong>{pending.name}</strong> ({formatMoney(pending.price_minor, pending.currency)}/mo) on {formatDate(sub.current_period_end)}.
            </p>
          )}

          <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4 text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <CreditCard className="size-4" />
              {sub.card_last4 ? (
                <span>
                  <span className="capitalize">{sub.card_brand}</span> •••• {sub.card_last4} {sub.card_exp && `· exp ${sub.card_exp}`}
                </span>
              ) : (
                "No saved card — renewals are paid by link"
              )}
            </span>
            {canManage && sub.card_last4 && (
              <SimpleAction label="Remove" action={removeCardAction} confirm={{ title: "Remove saved card?", description: "Renewals won't be charged automatically; we'll send you a payment link instead.", confirmLabel: "Remove card" }} />
            )}
          </div>

          {canManage && sub.status === "active" && (
            <div className="mt-4 flex flex-wrap gap-2">
              {(sub.cancel_at_period_end || pending) && (
                <SimpleAction
                  label={sub.cancel_at_period_end ? "Keep my plan" : "Cancel the switch"}
                  action={clearScheduledChangeAction}
                  confirm={{ title: "Keep your current plan?", description: `${plan.name} will renew as normal on ${formatDate(sub.current_period_end)}.`, confirmLabel: "Keep plan" }}
                />
              )}
              {!sub.cancel_at_period_end && (
                <SimpleAction
                  label="Cancel plan"
                  destructive
                  action={cancelSubscriptionAction}
                  confirm={{
                    title: "Cancel your plan?",
                    description: `You keep ${plan.name} until ${formatDate(sub.current_period_end)}. After that the AI assistant and automations stop; your data is kept.`,
                    confirmLabel: "Cancel at period end",
                  }}
                />
              )}
            </div>
          )}

          <h3 className="mt-6 mb-3 text-sm font-medium">Usage</h3>
          <dl className="grid gap-3.5">
            {METRICS.filter((m) => m.key in plan.limits).map((m) => {
              const limit = plan.limits[m.key];
              const n = usage[m.key] ?? 0;
              const pct = limit ? Math.min(100, (n / limit) * 100) : 0;
              return (
                <div key={m.key}>
                  <div className="flex justify-between text-sm">
                    <dt className="text-muted-foreground">
                      {m.label}
                      {m.monthly && <span className="text-xs"> · this month</span>}
                    </dt>
                    <dd className="tabular font-medium">
                      {n.toLocaleString()} / {limit === null ? "Unlimited" : limit.toLocaleString()}
                    </dd>
                  </div>
                  {limit !== null && limit > 0 && (
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className={pct >= 100 ? "h-full bg-destructive" : pct >= 80 ? "h-full bg-warning" : "h-full bg-primary"} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </dl>
        </section>

        <section className="grid content-start gap-4 sm:grid-cols-3">
          {((plans ?? []) as unknown as Plan[]).map((p) => {
            const change = planChange(state, { code: p.code, priceMinor: p.price_minor });
            const current = p.code === plan.code && (sub.status === "active" || sub.status === "past_due");
            const upgradeCost =
              change === "upgrade" ? prorateUpgrade({ fromPriceMinor: plan.price_minor, toPriceMinor: p.price_minor, periodStart: state.periodStart, periodEnd: state.periodEnd, now }) : 0;
            const button = (() => {
              if (!canManage || !billingReady) return null;
              switch (change) {
                case "same":
                  return null;
                case "resume":
                  return <ChoosePlanButton code={p.code} label="Keep this plan" action={changePlanAction} />;
                case "pay_renewal":
                  return current ? <ChoosePlanButton code={p.code} label="Pay now" action={changePlanAction} /> : null;
                case "subscribe":
                  return <ChoosePlanButton code={p.code} label={`Choose ${p.name}`} variant={p.code === "growth" ? "default" : "outline"} action={changePlanAction} />;
                case "upgrade":
                  return (
                    <ChoosePlanButton
                      code={p.code}
                      label={`Upgrade — ${formatMoney(upgradeCost, p.currency)} now`}
                      action={changePlanAction}
                      confirm={{
                        title: `Upgrade to ${p.name}?`,
                        description: `You'll pay ${formatMoney(upgradeCost, p.currency)} now for the rest of this period${sub.card_last4 ? ` (charged to •••• ${sub.card_last4})` : ""}, then ${formatMoney(p.price_minor, p.currency)}/mo from ${formatDate(sub.current_period_end)}. The upgrade applies immediately.`,
                      }}
                    />
                  );
                case "downgrade":
                  return pending?.name === p.name ? (
                    <p className="text-center text-xs text-muted-foreground">Scheduled for {formatDate(sub.current_period_end)}</p>
                  ) : (
                    <ChoosePlanButton
                      code={p.code}
                      label={`Switch to ${p.name}`}
                      variant="outline"
                      action={changePlanAction}
                      confirm={{
                        title: `Switch to ${p.name}?`,
                        description: `You keep ${plan.name} until ${formatDate(sub.current_period_end)}, then move to ${p.name} at ${formatMoney(p.price_minor, p.currency)}/mo. Check the lower limits fit your usage.`,
                      }}
                    />
                  );
              }
            })();
            return (
              <div key={p.id} className={current ? "flex flex-col rounded-xl border-2 border-primary bg-card p-5" : "flex flex-col rounded-xl border bg-card p-5"}>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{p.name}</h3>
                  {current && <Badge>Current</Badge>}
                </div>
                <div className="tabular mt-3 text-2xl font-semibold">
                  {formatMoney(p.price_minor, p.currency)}
                  <span className="text-sm font-normal text-muted-foreground">/{p.interval === "annually" ? "yr" : "mo"}</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{p.description}</p>
                <ul className="mt-4 grid flex-1 content-start gap-1.5 text-sm">
                  <li className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    {p.limits.monthly_ai_conversations === null ? "Unlimited" : p.limits.monthly_ai_conversations?.toLocaleString()} AI conversations/mo
                  </li>
                  <li className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    {p.limits.staff === null ? "Unlimited" : p.limits.staff} team member{p.limits.staff === 1 ? "" : "s"} · {p.limits.whatsapp_numbers ?? "Unlimited"} WhatsApp number
                    {p.limits.whatsapp_numbers === 1 ? "" : "s"}
                  </li>
                  {Object.entries(p.features)
                    .filter(([, on]) => on)
                    .map(([f]) => (
                      <li key={f} className="flex gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {FEATURES[f] ?? f}
                      </li>
                    ))}
                </ul>
                {button && <div className="mt-5">{button}</div>}
              </div>
            );
          })}
          {canManage && !billingReady && (
            <p className="text-sm text-muted-foreground sm:col-span-3">Online payment isn’t configured on this SellFlow installation yet (PAYSTACK_SECRET_KEY).</p>
          )}
        </section>
      </div>

      {canManage && (
        <section className="mt-6 rounded-xl border bg-card">
          <h2 className="p-6 pb-3 font-semibold">Invoices</h2>
          {invoices.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-6 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-6 py-2 font-medium">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id} className="border-b last:border-0">
                      <td className="px-6 py-2.5 whitespace-nowrap">{formatDate(i.paid_at ?? i.created_at)}</td>
                      <td className="px-3 py-2.5">
                        {KIND[i.kind]} · {(i.plan as unknown as { name: string } | null)?.name}
                        {i.period_start && i.period_end && (
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            ({formatDate(i.period_start)} – {formatDate(i.period_end)})
                          </span>
                        )}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">{formatMoney(i.amount_minor, i.currency)}</td>
                      <td className="px-3 py-2.5">
                        {i.status === "pending" && i.authorization_url ? (
                          <a href={i.authorization_url} className="font-medium text-primary hover:underline">
                            Pay now
                          </a>
                        ) : (
                          <Badge variant={i.status === "paid" ? "success" : i.status === "pending" ? "outline" : "secondary"} className="capitalize">
                            {i.status === "void" ? "Not used" : i.status}
                          </Badge>
                        )}
                      </td>
                      <td className="px-6 py-2.5 font-mono text-xs text-muted-foreground">{i.reference}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
