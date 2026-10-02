import type { Metadata } from "next";
import Link from "next/link";

import { FollowUpSettingsForm } from "@/components/automation/follow-up-settings-form";
import { Badge } from "@/components/ui/badge";
import { requireBusinessContext } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { daysAgoIso } from "@/lib/time";
import { delayToForm } from "@/lib/validation/follow-ups";
import { getReport } from "@/services/analytics/analytics.service";
import { DEFAULT_FOLLOW_UP_MESSAGE } from "@/services/automation/follow-ups.core";
import { getPlan, isSubscriptionUsable } from "@/services/billing/limits";

import { updateFollowUpSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Automation" };

const STATUS: Record<string, { label: string; variant: "success" | "secondary" | "outline" | "warning" | "destructive" }> = {
  scheduled: { label: "Scheduled", variant: "outline" },
  sent: { label: "Sent", variant: "success" },
  cancelled: { label: "Stopped", variant: "secondary" },
  skipped: { label: "Skipped", variant: "warning" },
  failed: { label: "Failed", variant: "destructive" },
};

const REASON: Record<string, string> = {
  purchased: "Customer paid",
  opted_out: "Customer replied STOP",
  human_handling: "Team took over",
  automation_disabled: "Automation turned off",
  plan: "Not on current plan",
  max_reached: "Max follow-ups reached",
  no_purchase_intent: "No longer a lead",
  conversation_closed: "Conversation closed",
  window_closed: "24h window closed, no template",
  out_of_stock: "Product out of stock",
  send_failed: "WhatsApp rejected the message",
  not_connected: "WhatsApp not connected",
  usage_limit: "Monthly message limit reached",
  payment_claimed: "Customer says they paid — awaiting your confirmation",
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default async function AutomationSettingsPage() {
  const ctx = await requireBusinessContext();
  if (!ctx.can("campaigns.manage")) {
    return <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">You don’t have permission to manage automation.</p>;
  }
  const db = await createClient();
  const admin = createAdminClient();
  const now = new Date();
  const [{ data: s }, { data: recent }, plan, report] = await Promise.all([
    db.from("ai_settings").select("*").eq("business_id", ctx.business.id).single(),
    db
      .from("follow_ups")
      .select("id, status, sequence_number, scheduled_for, sent_at, cancel_reason, channel, conversation_id, customers(name, profile_name, phone)")
      .eq("business_id", ctx.business.id)
      .order("created_at", { ascending: false })
      .limit(25),
    getPlan(admin, ctx.business.id),
    // Same definitions as Analytics (service role: campaigns.manage doesn't imply analytics.view).
    getReport(admin, ctx.business.id, new Date(daysAgoIso(30, now)), now),
  ]);
  if (!s) return <p className="text-sm text-muted-foreground">Automation settings are unavailable.</p>;

  const planAllows = Boolean(plan && isSubscriptionUsable(plan.status) && plan.features.follow_ups);
  const delay = delayToForm(s.follow_up_delay_minutes);

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Follow-ups sent (30 days)", value: report.follow_ups_sent.toLocaleString() },
          { label: "Recovered sales (30 days)", value: report.recovered_orders.toLocaleString() },
          { label: "Recovered revenue (30 days)", value: formatMoney(report.recovered_revenue_minor, ctx.business.currency) },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border bg-card p-5">
            <div className="text-sm text-muted-foreground">{stat.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{stat.value}</div>
          </div>
        ))}
      </div>

      <section className="rounded-xl border bg-card p-6 sm:p-8">
        <FollowUpSettingsForm
          action={updateFollowUpSettingsAction}
          planAllows={planAllows}
          timezone={ctx.business.timezone}
          defaultMessage={DEFAULT_FOLLOW_UP_MESSAGE}
          defaults={{
            enabled: s.follow_up_enabled,
            delayValue: delay.value,
            delayUnit: delay.unit,
            max: s.follow_up_max,
            message: s.follow_up_message ?? "",
            respectHours: s.follow_up_respect_hours,
            windowStart: s.follow_up_window_start,
            windowEnd: s.follow_up_window_end,
            templateName: s.follow_up_template_name ?? "",
            templateLanguage: s.follow_up_template_language,
            attributionWindowHours: s.attribution_window_hours,
          }}
        />
      </section>

      <section className="rounded-xl border bg-card">
        <div className="p-6 pb-3">
          <h2 className="font-semibold">Recent follow-ups</h2>
          <p className="mt-1 text-sm text-muted-foreground">Every follow-up is re-checked right before sending.</p>
        </div>
        {!recent?.length ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">No follow-ups yet. They appear here once a lead goes quiet after showing buying intent.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-6 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-6 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((f) => {
                  const c = f.customers as unknown as { name: string | null; profile_name: string | null; phone: string } | null;
                  const st = STATUS[f.status] ?? { label: f.status, variant: "outline" as const };
                  return (
                    <tr key={f.id} className="border-b last:border-0">
                      <td className="px-6 py-2.5">
                        <Link href={`/conversations/${f.conversation_id}`} className="font-medium hover:underline">
                          {c?.name ?? c?.profile_name ?? c?.phone ?? "Customer"}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{f.sequence_number}</td>
                      <td className="px-3 py-2.5">
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{when(f.sent_at ?? f.scheduled_for)}</td>
                      <td className="px-6 py-2.5 text-muted-foreground">
                        {f.cancel_reason ? (REASON[f.cancel_reason] ?? f.cancel_reason) : f.channel === "template" ? "Template" : f.status === "sent" ? "WhatsApp message" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
