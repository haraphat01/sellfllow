import type { Metadata } from "next";

import { SettingsForm } from "@/components/admin/settings-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { isAiConfigured, serverEnv } from "@/lib/env/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformSettings } from "@/services/admin/admin.service";
import { isBillingConfigured } from "@/services/billing/billing.service";

import { saveSettingsAction } from "../actions";

export const metadata: Metadata = { title: "Settings · Admin" };

export default async function AdminSettingsPage() {
  await requirePlatformAdmin();
  const settings = await getPlatformSettings(createAdminClient());
  const env = serverEnv();
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
