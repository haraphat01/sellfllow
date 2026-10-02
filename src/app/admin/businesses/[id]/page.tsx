import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";

import { BusinessAdminActions } from "@/components/admin/business-actions";
import { Badge } from "@/components/ui/badge";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBusinessDetail } from "@/services/admin/admin.service";
import { getReport } from "@/services/analytics/analytics.service";
import { listInvoices } from "@/services/billing/billing.service";
import { usageSummary } from "@/services/billing/limits";

import { extendTrialAction, grantPlanAction, setSuspendedAction } from "../../actions";

export const metadata: Metadata = { title: "Business · Admin" };

const USAGE_LABEL: Record<string, string> = {
  monthly_ai_conversations: "AI conversations (month)",
  messages: "Messages (month)",
  orders: "Orders (month)",
  customers: "Customers",
  products: "Products",
  staff: "Team + invites",
  whatsapp_numbers: "WhatsApp numbers",
};

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border bg-card p-6 ${className}`}>
      <h2 className="mb-4 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function AdminBusinessPage({ params }: PageProps<"/admin/businesses/[id]">) {
  await requirePlatformAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const admin = createAdminClient();
  const detail = await getBusinessDetail(admin, id);
  if (!detail) notFound();
  const now = new Date();
  const [usage, invoices, report, { data: plans }] = await Promise.all([
    usageSummary(admin, id, now),
    listInvoices(admin, id),
    getReport(admin, id, new Date(now.getTime() - 30 * 86_400_000), now),
    admin.from("subscription_plans").select("code, name").eq("is_active", true).order("sort_order"),
  ]);
  const { business: b, subscription: sub } = detail;
  const plan = sub?.plan as unknown as { code: string; name: string; price_minor: number; currency: string; limits?: Record<string, number | null> } | null;
  const limits = plan?.limits ?? {};
  const pending = sub?.pending as unknown as { name: string } | null;

  return (
    <>
      <Link href="/admin/businesses" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Businesses
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{b.name}</h1>
            <Badge variant={b.status === "active" ? "success" : "destructive"} className="capitalize">
              {b.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {b.slug} · {b.country} · {b.currency} · {b.timezone} · created {formatDate(b.created_at)} · <span className="font-mono text-xs">{b.id}</span>
          </p>
        </div>
        <BusinessAdminActions
          businessId={b.id}
          businessName={b.name}
          suspended={b.status === "suspended"}
          canExtendTrial={!sub || !["active", "past_due"].includes(sub.status)}
          plans={plans ?? []}
          actions={{ setSuspended: setSuspendedAction, grantPlan: grantPlanAction, extendTrial: extendTrialAction }}
        />
      </div>

      {b.status === "suspended" && (
        <p className="mb-6 flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="size-4" /> Suspended: {b.suspended_reason ?? "no reason recorded"}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Subscription">
          {sub ? (
            <dl className="grid gap-2 text-sm">
              {[
                ["Plan", `${plan?.name ?? "—"}${sub.is_complimentary ? " (complimentary)" : ""}`],
                ["Status", sub.status.replace("_", " ")],
                ["Period", `${formatDate(sub.current_period_start)} – ${formatDate(sub.current_period_end)}`],
                ["Trial ends", sub.trial_ends_at ? formatDate(sub.trial_ends_at) : "—"],
                ["Renews", sub.cancel_at_period_end ? "No (ends at period end)" : pending ? `Switching to ${pending.name}` : "Yes"],
                ["Card", sub.card_last4 ? `${sub.card_brand} •••• ${sub.card_last4}` : "None"],
                ["Billing email", sub.billing_email ?? "—"],
                ["Failed renewals", sub.renewal_attempts],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right font-medium capitalize">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No subscription.</p>
          )}
        </Card>

        <Card title="Usage">
          <dl className="grid gap-2 text-sm">
            {Object.entries(USAGE_LABEL).map(([k, label]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular font-medium">
                  {(usage[k as keyof typeof usage] ?? 0).toLocaleString()} / {limits[k] === null || limits[k] === undefined ? "∞" : limits[k]!.toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Last 30 days">
          <dl className="grid gap-2 text-sm">
            {[
              ["Revenue (verified)", formatMoney(report.revenue_minor, report.currency)],
              ["Paid orders", report.orders_paid],
              ["Conversations", report.conversations_active],
              ["Leads → paid", `${report.leads_converted} / ${report.leads}`],
              ["AI conversations", report.ai_conversations],
              ["Handoffs to team", report.handoffs],
              ["Totals", `${detail.counts.customers} customers · ${detail.counts.orders} orders · ${detail.counts.products} products`],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="tabular text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Team">
          <ul className="grid gap-2 text-sm">
            {detail.members.map((m) => (
              <li key={m.user_id} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  {m.name ?? m.email} <span className="text-xs text-muted-foreground">{m.name ? m.email : ""}</span>
                </span>
                <span className="text-muted-foreground capitalize">
                  {m.role}
                  {m.status !== "active" && ` (${m.status})`}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="WhatsApp">
          {detail.whatsappAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No number connected.</p>
          ) : (
            <ul className="grid gap-3 text-sm">
              {detail.whatsappAccounts.map((a) => (
                <li key={a.id}>
                  <div className="flex justify-between gap-3">
                    <span className="font-medium">{a.display_phone_number ?? "—"}</span>
                    <Badge variant={a.status === "connected" ? "success" : a.status === "pending" ? "outline" : "destructive"} className="capitalize">
                      {a.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {a.verified_name ?? ""} {a.quality_rating ? `· quality ${a.quality_rating}` : ""}
                  </div>
                  {a.last_error && <div className="mt-1 text-xs text-destructive">{a.last_error}</div>}
                </li>
              ))}
            </ul>
          )}
          {detail.failedMessages.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <h3 className="mb-2 text-xs font-medium text-muted-foreground uppercase">Failed sends (30 days)</h3>
              <ul className="grid gap-1.5 text-xs">
                {detail.failedMessages.map((m) => (
                  <li key={m.id} className="truncate" title={m.error ?? ""}>
                    {formatDate(m.created_at)} · {m.sender}: {m.error ?? "unknown error"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Payouts">
          {detail.payoutAccount ? (
            <dl className="grid gap-2 text-sm">
              {[
                ["Bank", `${detail.payoutAccount.bank_name} •••• ${detail.payoutAccount.account_number_last4}`],
                ["Account name", detail.payoutAccount.account_name],
                ["Subaccount", detail.payoutAccount.subaccount_code],
                ["Status", detail.payoutAccount.status],
                ["Last changed", formatDate(detail.payoutAccount.updated_at)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right font-medium break-all">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No payout bank account — this business can’t take online payments.</p>
          )}
        </Card>

        <Card title="Invoices">
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {invoices.slice(0, 8).map((i) => (
                <li key={i.id} className="flex justify-between gap-3">
                  <span>
                    {formatDate(i.paid_at ?? i.created_at)} · <span className="capitalize">{i.kind}</span>
                  </span>
                  <span className="tabular">
                    {formatMoney(i.amount_minor, i.currency)} <span className="text-xs text-muted-foreground">{i.status}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent activity" className="lg:col-span-3">
          {detail.audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="grid gap-1.5 text-sm">
              {detail.audit.map((a) => (
                <li key={a.id} className="flex flex-wrap gap-x-3">
                  <span className="w-36 shrink-0 text-muted-foreground">{new Date(a.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
                  <span className="font-mono text-xs leading-5">{a.action}</span>
                  <span className="text-xs leading-5 text-muted-foreground">{a.actor_type}</span>
                  {a.actor_type === "admin" && (a.metadata as { reason?: string }).reason && (
                    <span className="text-xs leading-5 text-muted-foreground">“{(a.metadata as { reason?: string }).reason}”</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
