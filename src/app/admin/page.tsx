import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { BarChart, RangeTabs } from "@/components/analytics/charts";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformStats } from "@/services/admin/admin.service";
import { percent } from "@/services/analytics/analytics.core";

export const metadata: Metadata = { title: "Platform admin" };

const RANGES = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
] as const;

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-2.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="tabular font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  // Re-check here too: layouts don't guard data fetched by the page.
  await requirePlatformAdmin();
  const r = String((await searchParams).range ?? "30");
  const days = r === "7" || r === "90" ? Number(r) : 30;
  const s = await getPlatformStats(createAdminClient(), days);
  const errorsTotal = Object.values(s.errors).reduce((a, b) => a + b, 0) + s.renewals_failed;
  const days_ = s.signups_daily.map((d) => ({ key: d.day, label: new Date(`${d.day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }), value: d.n }));

  return (
    <>
      <PageHeader title="Platform" description={`All SellFlow tenants · last ${days} days where noted.`} actions={<RangeTabs active={String(days)} ranges={RANGES} />} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="MRR" value={formatMoney(s.mrr_minor, "NGN")} hint={`${s.paying} paying · ${s.complimentary} complimentary`} emphasis />
        <StatCard label="Businesses" value={s.businesses_total.toLocaleString()} hint={`${s.businesses_active} active · ${s.businesses_suspended} suspended · ${s.businesses_new} new`} />
        <StatCard label="Churn" value={percent(s.churnRate)} hint={`${s.churned} paying lost · ${s.trials_expired} trials not converted`} />
        <StatCard label="SellFlow revenue" value={formatMoney(s.sellflow_revenue_minor, "NGN")} hint="Subscription payments received" />
        <StatCard label="Messages" value={s.messages.toLocaleString()} hint={`${s.messages_failed.toLocaleString()} failed to send`} />
        <StatCard label="AI conversations" value={s.ai_conversations_this_month.toLocaleString()} hint={`This month · ${s.ai_requests.toLocaleString()} AI calls in period`} />
        <StatCard label="Orders" value={s.orders.toLocaleString()} hint={`${s.orders_paid.toLocaleString()} paid`} />
        <StatCard
          label="Payment volume"
          value={Object.entries(s.payment_volume).length ? Object.entries(s.payment_volume).map(([c, v]) => formatMoney(v, c)).join(" · ") : formatMoney(0, "NGN")}
          hint="Merchants' verified customer payments"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel title="New businesses per day">
          {days_.length ? <BarChart label="Signups" data={days_} format={(v) => v.toLocaleString()} /> : <p className="text-sm text-muted-foreground">No signups in this period.</p>}
        </Panel>
        <Panel title="Subscriptions">
          <Rows
            rows={[
              ["Trialing", s.subscriptions.trialing ?? 0],
              ["Active", s.subscriptions.active ?? 0],
              ["Payment due (grace)", s.subscriptions.past_due ?? 0],
              ["Cancelled", s.subscriptions.cancelled ?? 0],
              ["Expired", s.subscriptions.expired ?? 0],
              ...Object.entries(s.paying_by_plan).map(([k, v]) => [`Paying · ${k}`, v] as [string, number]),
            ]}
          />
        </Panel>
        <Panel
          title="System health"
          action={
            <Link href="/admin/logs?tab=failures" className="text-sm font-medium text-primary hover:underline">
              View failures →
            </Link>
          }
        >
          {errorsTotal > 0 && (
            <p className="mb-3 flex items-center gap-2 rounded-md bg-warning/15 px-3 py-2 text-sm">
              <AlertTriangle className="size-4" /> {errorsTotal} problem{errorsTotal === 1 ? "" : "s"} in this period
            </p>
          )}
          <Rows
            rows={[
              ["WhatsApp webhook events failed", s.errors.whatsapp_events_failed],
              ["Paystack webhook events failed", s.errors.payment_events_failed],
              ["Follow-ups failed", s.errors.follow_ups_failed],
              ["AI errors (handed to team)", s.errors.ai_handoffs_on_error],
              ["Renewal charges failed", s.renewals_failed],
              ["WhatsApp numbers connected", s.whatsapp_accounts.connected ?? 0],
              ["WhatsApp numbers in error / disconnected", (s.whatsapp_accounts.error ?? 0) + (s.whatsapp_accounts.disconnected ?? 0)],
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
