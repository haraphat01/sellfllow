import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";

import { BarChart, Funnel, Kpi, RangeTabs } from "@/components/analytics/charts";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { requireBusinessContext } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { change, derived, parseRange, percent } from "@/services/analytics/analytics.core";
import { getAnalytics } from "@/services/analytics/analytics.service";
import { getPlan, isSubscriptionUsable } from "@/services/billing/limits";

export const metadata: Metadata = { title: "Analytics" };

const RANGE_OPTIONS = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
] as const;

const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function Panel({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border bg-card p-6 ${className ?? ""}`}>
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const ctx = await requireBusinessContext();
  if (!ctx.can("analytics.view")) {
    return <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">You don’t have permission to view analytics.</p>;
  }
  const range = parseRange((await searchParams).range);
  const plan = await getPlan(createAdminClient(), ctx.business.id);
  const advanced = Boolean(plan && isSubscriptionUsable(plan.status) && plan.features.advanced_analytics);

  const { current: r, previous: p, period } = await getAnalytics(await createClient(), ctx.business.id, ctx.business.timezone, range, { compare: advanced });
  const d = derived(r);
  const pd = p ? derived(p) : null;
  const money = (v: number) => formatMoney(v, r.currency);
  const delta = (cur: number | null, prev: number | null | undefined) => (p ? change(cur, prev ?? null) : undefined);

  return (
    <>
      <PageHeader
        title="Analytics"
        description={`Last ${period.days} days, ${r.timezone} time. Only payments verified by Paystack count as revenue.`}
        actions={<RangeTabs active={range} ranges={RANGE_OPTIONS} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Revenue" value={money(r.revenue_minor)} delta={delta(r.revenue_minor, p?.revenue_minor)} sub={r.refunded_minor ? `${money(r.refunded_minor)} refunded` : undefined} emphasis />
        <Kpi label="Paid orders" value={r.orders_paid.toLocaleString()} delta={delta(r.orders_paid, p?.orders_paid)} sub={`${r.orders_created.toLocaleString()} placed`} />
        <Kpi label="Conversations" value={r.conversations_active.toLocaleString()} delta={delta(r.conversations_active, p?.conversations_active)} sub={`${r.conversations_new.toLocaleString()} new`} />
        <Kpi label="Leads (purchase intent)" value={r.leads.toLocaleString()} delta={delta(r.leads, p?.leads)} />
        <Kpi label="Conversion rate" value={percent(d.conversionRate)} delta={delta(d.conversionRate, pd?.conversionRate)} sub={`${r.leads_converted} of ${r.leads} leads paid`} />
        <Kpi label="Average order value" value={d.averageOrderMinor === null ? "—" : money(d.averageOrderMinor)} delta={delta(d.averageOrderMinor, pd?.averageOrderMinor)} />
        <Kpi
          label="AI-assisted sales"
          value={money(r.ai_assisted_revenue_minor)}
          delta={delta(r.ai_assisted_revenue_minor, p?.ai_assisted_revenue_minor)}
          sub={`${r.ai_assisted_orders} orders · ${percent(d.aiShare, 0)} of revenue`}
        />
        <Kpi
          label="Recovered sales"
          value={money(r.recovered_revenue_minor)}
          delta={delta(r.recovered_revenue_minor, p?.recovered_revenue_minor)}
          sub={`${r.recovered_orders} orders from ${r.follow_ups_sent} follow-ups`}
        />
      </div>

      {advanced ? (
        <>
          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <Panel title="Revenue per day">
              <BarChart label="Revenue per day" data={r.daily.map((x) => ({ key: x.day, label: dayLabel(x.day), value: x.revenue_minor }))} format={money} />
            </Panel>
            <Panel title="Leads per day" description="Conversations where the AI recorded purchase intent.">
              <BarChart label="Leads per day" tone="signal" data={r.daily.map((x) => ({ key: x.day, label: dayLabel(x.day), value: x.leads }))} format={(v) => v.toLocaleString()} />
            </Panel>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            <Panel title="Sales funnel" description="Counts within this period.">
              <Funnel
                steps={[
                  { label: "Customers who messaged", value: r.conversations_active },
                  { label: "Showed purchase intent", value: r.leads },
                  { label: "Orders placed", value: r.orders_created },
                  { label: "Orders paid", value: r.orders_paid },
                ]}
              />
            </Panel>
            <Panel title="Top products" description="By paid item revenue (excluding delivery fees).">
              {r.top_products.length === 0 ? (
                <p className="text-sm text-muted-foreground">No paid orders in this period.</p>
              ) : (
                <ol className="grid gap-3 text-sm">
                  {r.top_products.map((t, i) => (
                    <li key={t.name} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate">
                        <span className="mr-2 text-muted-foreground tabular-nums">{i + 1}</span>
                        {t.name}
                      </span>
                      <span className="shrink-0 tabular">
                        {money(t.revenue_minor)} <span className="text-xs text-muted-foreground">× {t.quantity}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
            <Panel title="AI & automation">
              <dl className="grid gap-3 text-sm">
                {[
                  ["Conversations the AI replied in", r.ai_conversations.toLocaleString()],
                  ["Handed to your team", r.handoffs.toLocaleString()],
                  ["Follow-ups sent", r.follow_ups_sent.toLocaleString()],
                  ["Follow-ups that recovered a sale", percent(d.recoveryRate)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="tabular font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          </div>
        </>
      ) : (
        <section className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-dashed bg-card p-6">
          <div className="flex gap-3">
            <Lock className="mt-0.5 size-5 text-muted-foreground" />
            <div>
              <h2 className="font-semibold">Trends, funnel and top products</h2>
              <p className="mt-1 text-sm text-muted-foreground">Daily trends, period-over-period comparison, the sales funnel and product rankings are included from the Growth plan.</p>
            </div>
          </div>
          {ctx.can("billing.manage") && (
            <Button asChild variant="outline">
              <Link href="/billing">See plans</Link>
            </Button>
          )}
        </section>
      )}

      <section className="mt-6 rounded-xl border bg-card p-6 text-sm">
        <h2 className="font-semibold">How we count</h2>
        <dl className="mt-4 grid gap-4 text-muted-foreground md:grid-cols-2">
          {[
            ["Revenue", "Orders whose payment Paystack verified in this period (by payment time), minus orders later refunded. Never the customer’s word or the browser."],
            ["Lead", "A conversation where the AI recorded purchase intent — choosing a product, collecting details or confirming an order. Counted once per intent, when it happens."],
            ["Conversion rate", "Leads from this period who then paid for an order in the same conversation, at any time after showing intent."],
            ["AI-assisted sale", "A paid order the AI created in the chat after the customer confirmed it. Orders your team created aren’t counted, even if the AI chatted first."],
            ["Recovered sale", "A paid order from a lead who received an automated follow-up within your attribution window before paying (Settings → Automation)."],
            ["Conversations", "Customers who sent at least one message in this period; “new” are conversations started in the period."],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="font-medium text-foreground">{k}</dt>
              <dd className="mt-0.5">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
