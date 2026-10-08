import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";

import { AiSettingsForm } from "@/components/ai/ai-settings-form";
import { Playground } from "@/components/ai/playground";
import { requireBusinessContext } from "@/lib/auth/session";
import { isAiConfigured, serverEnv } from "@/lib/env/server";
import { createClient } from "@/lib/supabase/server";
import { AI_MODELS } from "@/lib/validation/ai-settings";

import { updateAiSettingsAction } from "./actions";

export const metadata: Metadata = { title: "AI assistant" };

const minorToInput = (minor: number) => (minor / 100).toString();

export default async function AiSettingsPage() {
  const ctx = await requireBusinessContext();
  const db = await createClient();
  const [{ data: agent }, { data: settings }] = await Promise.all([
    db.from("ai_agents").select("*").eq("business_id", ctx.business.id).single(),
    db.from("ai_settings").select("*").eq("business_id", ctx.business.id).single(),
  ]);
  const aiConfigured = isAiConfigured();
  const canManage = ctx.can("settings.manage");

  if (!agent || !settings) return <p className="text-sm text-muted-foreground">AI settings are unavailable.</p>;
  if (!canManage) return <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">You don’t have permission to change the AI assistant.</p>;

  const zones = (Array.isArray(settings.delivery_zones) ? settings.delivery_zones : []) as { name?: string; fee_minor?: number; eta?: string | null }[];
  const hours = typeof settings.business_hours === "string" ? settings.business_hours : "";

  return (
    <div className="grid gap-6">
      {!aiConfigured && (
        <div className="flex gap-3 rounded-xl border border-warning/50 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="size-5 shrink-0 text-[oklch(0.5_0.12_70)]" />
          <div>
            <div className="font-medium">AI isn’t configured on this SellFlow installation</div>
            <p className="mt-1 text-muted-foreground">
              The platform operator needs to set <code>AI_GATEWAY_API_KEY</code> or <code>DEEPSEEK_API_KEY</code>. You can still prepare your settings below.
            </p>
          </div>
        </div>
      )}
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_400px]">
        <section className="rounded-xl border bg-card p-6 sm:p-8">
          <AiSettingsForm
            action={updateAiSettingsAction}
            models={AI_MODELS}
            defaultModelLabel={AI_MODELS.find((m) => m.id === serverEnv().AI_DEFAULT_MODEL)?.label ?? serverEnv().AI_DEFAULT_MODEL}
            currency={ctx.business.currency}
            aiConfigured={aiConfigured}
            defaults={{
              enabled: agent.enabled,
              name: agent.name,
              tone: agent.tone,
              greeting: agent.greeting ?? "",
              language: agent.language,
              model: agent.model ?? "",
              return_policy: settings.return_policy ?? "",
              delivery_policy: settings.delivery_policy ?? "",
              delivery_zones: zones.filter((z) => z.name).map((z) => ({ name: z.name!, fee: minorToInput(z.fee_minor ?? 0), eta: z.eta ?? "" })),
              business_hours: hours,
              discount_rules: settings.discount_rules ?? "",
              max_discount_percent: Number(settings.max_discount_percent ?? 0),
              escalation_rules: settings.escalation_rules ?? "",
              payment_rules: settings.payment_rules ?? "",
              ai_resume_after_minutes: settings.ai_resume_after_minutes,
            }}
          />
        </section>
        <div className="xl:sticky xl:top-20">
          <Playground enabled={aiConfigured} />
        </div>
      </div>
    </div>
  );
}
