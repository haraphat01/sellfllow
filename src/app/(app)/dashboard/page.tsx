import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bot, Building2, CheckCircle2, Circle, CreditCard, MessageCircle, Package, Send } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui/button";
import { requireBusinessContext } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDashboardSummary, getSetupChecklist } from "@/services/business/business.service";
import { derived, percent } from "@/services/analytics/analytics.core";
import { getAnalytics } from "@/services/analytics/analytics.service";
import { canCollectPayments } from "@/services/payments/payments.service";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const ctx = await requireBusinessContext();
  const db = await createClient();
  const canAnalytics = ctx.can("analytics.view");
  const [summary, setup, analytics] = await Promise.all([
    getDashboardSummary(db, ctx.business.id),
    getSetupChecklist(db, ctx.business.id, await canCollectPayments(createAdminClient(), ctx.business.id)),
    canAnalytics ? getAnalytics(db, ctx.business.id, ctx.business.timezone, "30d", { compare: false }) : Promise.resolve(null),
  ]);
  const report = analytics?.current;
  const { welcome } = await searchParams;

  const steps = [
    { done: true, icon: Building2, title: "Create your business", body: "Profile, region and contact details.", href: "/settings" },
    { done: setup.whatsappConnected, icon: MessageCircle, title: "Connect WhatsApp", body: "Link your WhatsApp Business number through Meta.", href: "/settings/whatsapp" },
    { done: setup.productCount > 0, icon: Package, title: "Add products", body: "Your AI agent only sells what’s in your catalogue.", href: "/products" },
    { done: setup.aiEnabled, icon: Bot, title: "Configure your AI agent", body: "Tone, policies, delivery fees and escalation rules.", href: "/settings/ai" },
    { done: setup.paystackConnected, icon: CreditCard, title: "Set up payments", body: "Add your bank account — Paystack settles customer payments straight to it.", href: "/settings/payments" },
    { done: false, icon: Send, title: "Send a test message", body: "Message your number and watch the agent respond.", href: "/settings/whatsapp" },
  ];
  const completed = steps.filter((s) => s.done).length;
  const currency = ctx.business.currency;

  return (
    <>
      <PageHeader
        title={welcome ? `Welcome to SellFlow, ${ctx.business.name}` : "Overview"}
        description="Last 30 days across your WhatsApp sales."
      />

      {report ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Revenue (paid)" value={formatMoney(report.revenue_minor, currency)} hint="Verified Paystack payments, net of refunds" emphasis />
            <StatCard label="Paid orders" value={report.orders_paid.toLocaleString()} hint={`${report.orders_created.toLocaleString()} placed`} />
            <StatCard label="Conversion rate" value={percent(derived(report).conversionRate)} hint={`${report.leads_converted} of ${report.leads} leads paid`} />
            <StatCard label="Recovered sales" value={formatMoney(report.recovered_revenue_minor, currency)} hint={`AI-assisted: ${formatMoney(report.ai_assisted_revenue_minor, currency)}`} />
          </div>
          <div className="mt-3 text-right">
            <Link href="/analytics" className="text-sm font-medium text-primary hover:underline">
              Full analytics →
            </Link>
          </div>
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Revenue (paid)" value={formatMoney(summary.paidRevenueMinor, currency)} hint="Verified Paystack payments only" emphasis />
          <StatCard label="Orders" value={summary.orders.toLocaleString()} />
          <StatCard label="Conversations" value={summary.conversations.toLocaleString()} />
          <StatCard label="Customers" value={summary.customers.toLocaleString()} hint="All time" />
        </div>
      )}

      {completed < steps.length && ctx.can("settings.manage") && (
        <section className="mt-8 rounded-xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-5">
            <div>
              <h2 className="font-semibold">Get ready to sell</h2>
              <p className="text-sm text-muted-foreground">
                {completed} of {steps.length} steps complete
              </p>
            </div>
            <div className="h-2 w-48 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(completed / steps.length) * 100}%` }} />
            </div>
          </div>
          <ul className="divide-y">
            {steps.map(({ done, icon: Icon, title, body, href }) => (
              <li key={title} className="flex items-center gap-4 px-6 py-4">
                {done ? <CheckCircle2 className="size-5 shrink-0 text-success" /> : <Circle className="size-5 shrink-0 text-border" />}
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className={done ? "text-sm font-medium text-muted-foreground line-through decoration-border" : "text-sm font-medium"}>{title}</div>
                  <div className="text-sm text-muted-foreground">{body}</div>
                </div>
                {!done && (
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={href}>
                      Start <ArrowRight />
                    </Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
