import type { Metadata } from "next";

import { SettingsForm } from "@/components/admin/settings-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { isAiConfigured, serverEnv } from "@/lib/env/server";
import { getScheduledTaskRuns, SCHEDULED_TASKS } from "@/jobs/scheduled";
import { formatDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformSettings } from "@/services/admin/admin.service";
import { isBillingConfigured } from "@/services/billing/billing.service";

import { saveSettingsAction } from "../actions";

export const metadata: Metadata = { title: "Settings · Admin" };

export default async function AdminSettingsPage() {
  await requirePlatformAdmin();
  const settings = await getPlatformSettings(createAdminClient());
  const env = serverEnv();
  const cronRuns = await getScheduledTaskRuns(createAdminClient());
  const cronSecretOk = (env.CRON_SECRET?.trim().length ?? 0) >= 24;
  const checks: [string, boolean, string][] = [
    ["AI provider", isAiConfigured(), "AI_GATEWAY_API_KEY or DEEPSEEK_API_KEY"],
    ["Subscription billing (Paystack)", isBillingConfigured(), "PAYSTACK_SECRET_KEY"],
    ["WhatsApp app", Boolean(env.META_APP_ID && env.META_APP_SECRET), "META_APP_ID, META_APP_SECRET"],
    ["WhatsApp Embedded Signup", Boolean(env.META_CONFIG_ID), "META_CONFIG_ID"],
    ["Credential encryption", Boolean(env.CREDENTIALS_ENCRYPTION_KEY), "CREDENTIALS_ENCRYPTION_KEY"],
  ];

  return (
    <>
      <PageHeader title="Platform settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-6">
          <SettingsForm action={saveSettingsAction} defaults={settings} />
        </section>
        <section className="rounded-xl border bg-card p-6 lg:col-span-2">
          <h2 className="font-semibold">Scheduled tasks</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Run by Coolify scheduled tasks with <code>node scripts/cron.mjs &lt;task&gt;</code> (see DEPLOYMENT.md). Shared secret{" "}
            <code>CRON_SECRET</code>:{" "}
            <span className={cronSecretOk ? "text-success" : "text-destructive"}>{cronSecretOk ? "set" : "missing or shorter than 24 characters"}</span>
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Task</th>
                  <th className="py-1.5 pr-3 font-medium">Schedule</th>
                  <th className="py-1.5 pr-3 font-medium">Last run</th>
                  <th className="py-1.5 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {Object.entries(SCHEDULED_TASKS).map(([name, t]) => {
                  const r = cronRuns[name as keyof typeof SCHEDULED_TASKS];
                  return (
                    <tr key={name}>
                      <td className="py-2 pr-3 font-mono text-xs">{name}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">{t.every}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                        {r ? `${formatDate(r.at)} ${new Date(r.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Never"}
                      </td>
                      <td className={r ? (r.ok ? "py-2 text-success" : "py-2 text-destructive") : "py-2 text-muted-foreground"} title={r?.error ?? JSON.stringify(r?.result ?? {})}>
                        {r ? (r.ok ? `OK · ${r.ms} ms` : `Failed: ${r.error}`) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <section className="rounded-xl border bg-card p-6">
          <h2 className="font-semibold">Configuration</h2>
          <p className="mt-1 text-sm text-muted-foreground">Set with environment variables on the server; values are never shown here.</p>
          <ul className="mt-4 grid gap-2.5 text-sm">
            {checks.map(([label, ok, env]) => (
              <li key={label} className="flex items-center justify-between gap-3">
                <span>
                  {label} <span className="font-mono text-xs text-muted-foreground">{env}</span>
                </span>
                <span className={ok ? "text-success" : "text-destructive"}>{ok ? "Configured" : "Missing"}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
