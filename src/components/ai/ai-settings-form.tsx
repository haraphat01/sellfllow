"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/lib/action-types";
import { useFormAction } from "@/lib/use-form-action";

export type AiSettingsDefaults = {
  enabled: boolean;
  name: string;
  tone: string;
  greeting: string;
  language: string;
  model: string;
  return_policy: string;
  delivery_policy: string;
  delivery_zones: { name: string; fee: string; eta: string }[];
  business_hours: string;
  discount_rules: string;
  max_discount_percent: number;
  escalation_rules: string;
  payment_rules: string;
};

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-6 border-t py-8 first-of-type:border-t-0 first-of-type:pt-0 md:grid-cols-[240px_1fr]">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4">{children}</div>
    </div>
  );
}

function Area({ label, name, defaultValue, placeholder, hint }: { label: string; name: string; defaultValue: string; placeholder: string; hint?: string }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={`f-${name}`}>{label}</Label>
      <Textarea id={`f-${name}`} name={name} defaultValue={defaultValue} placeholder={placeholder} rows={3} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

let seq = 0;

export function AiSettingsForm({
  action,
  defaults,
  models,
  defaultModelLabel,
  currency,
  aiConfigured,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  defaults: AiSettingsDefaults;
  models: readonly { id: string; label: string }[];
  defaultModelLabel: string;
  currency: string;
  aiConfigured: boolean;
}) {
  const { state, pending, formProps } = useFormAction(action);
  const [zones, setZones] = useState(() => defaults.delivery_zones.map((z) => ({ ...z, key: ++seq })));
  const fe = state?.fieldErrors ?? {};

  useEffect(() => {
    if (state?.ok) toast.success(state.message ?? "Saved");
    else if (state?.error) toast.error(state.error);
  }, [state]);

  const setZone = (key: number, patch: Partial<{ name: string; fee: string; eta: string }>) => setZones((zs) => zs.map((z) => (z.key === key ? { ...z, ...patch } : z)));

  return (
    <form {...formProps} autoComplete="off">
      <input type="hidden" name="delivery_zones" value={JSON.stringify(zones.map(({ name, fee, eta }) => ({ name, fee, eta })))} />

      <Section title="Assistant" description="Replies to customers on WhatsApp when a conversation is in AI mode.">
        <label className="flex items-start gap-3 rounded-lg border p-4">
          <Checkbox name="enabled" defaultChecked={defaults.enabled} className="mt-0.5" disabled={!aiConfigured && !defaults.enabled} />
          <span>
            <span className="block text-sm font-medium">Let the AI reply to customers</span>
            <span className="block text-sm text-muted-foreground">
              {aiConfigured
                ? "It only uses your catalogue and the policies below, and hands over to your team when unsure."
                : "Unavailable: no AI provider is configured on this installation yet."}
            </span>
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assistant name" name="name" defaultValue={defaults.name} errors={fe.name} />
          <div className="grid gap-2">
            <Label htmlFor="f-tone">Tone</Label>
            <NativeSelect id="f-tone" name="tone" defaultValue={defaults.tone}>
              <option value="friendly">Friendly</option>
              <option value="professional">Professional</option>
              <option value="playful">Playful</option>
              <option value="concise">Concise</option>
            </NativeSelect>
          </div>
        </div>
        <Field label="Greeting for new customers" name="greeting" defaultValue={defaults.greeting} placeholder="Hi! Welcome to Aisha Fashion 👋 How can I help you today?" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="f-model">Model</Label>
            <NativeSelect id="f-model" name="model" defaultValue={models.some((m) => m.id === defaults.model) ? defaults.model : ""}>
              <option value="">Platform default ({defaultModelLabel})</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Field label="Default language" name="language" defaultValue={defaults.language} placeholder="en" />
        </div>
      </Section>

      <Section title="Delivery" description="The AI quotes delivery fees only from these zones — never guesses.">
        <Area label="Delivery policy" name="delivery_policy" defaultValue={defaults.delivery_policy} placeholder="We deliver within Lagos in 1–2 working days and nationwide in 3–5 days via GIG." />
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label>Delivery zones &amp; fees ({currency})</Label>
            <Button type="button" variant="outline" size="sm" onClick={() => setZones((z) => [...z, { key: ++seq, name: "", fee: "", eta: "" }])}>
              <Plus /> Add zone
            </Button>
          </div>
          {zones.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">No zones. The AI will hand over to your team when asked about delivery fees.</p>
          ) : (
            <div className="grid gap-2">
              {zones.map((z, i) => (
                <div key={z.key} className="grid grid-cols-[1fr_110px_1fr_auto] items-start gap-2">
                  <div>
                    <Input aria-label="Zone" placeholder="Lagos Mainland" value={z.name} onChange={(e) => setZone(z.key, { name: e.target.value })} aria-invalid={fe[`delivery_zones.${i}.name`] ? true : undefined} />
                  </div>
                  <div>
                    <Input aria-label="Fee" inputMode="decimal" placeholder="3000" value={z.fee} onChange={(e) => setZone(z.key, { fee: e.target.value })} aria-invalid={fe[`delivery_zones.${i}.fee`] ? true : undefined} />
                    {fe[`delivery_zones.${i}.fee`] && <p className="mt-1 text-xs text-destructive">{fe[`delivery_zones.${i}.fee`]?.[0]}</p>}
                  </div>
                  <Input aria-label="Delivery time" placeholder="1–2 working days" value={z.eta} onChange={(e) => setZone(z.key, { eta: e.target.value })} />
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove zone" onClick={() => setZones((zs) => zs.filter((x) => x.key !== z.key))}>
                    <Trash2 className="text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      <Section title="Policies" description="Written the way you'd explain them to a new sales assistant. The AI follows them but can't override its safety rules.">
        <Area label="Returns & exchanges" name="return_policy" defaultValue={defaults.return_policy} placeholder="Exchanges within 7 days if unused and with tags. No cash refunds on sale items." />
        <Area label="Payment" name="payment_rules" defaultValue={defaults.payment_rules} placeholder="Payment before delivery via card or bank transfer. No pay-on-delivery." />
        <Field label="Business hours" name="business_hours" defaultValue={defaults.business_hours} placeholder="Mon–Sat, 9am–6pm" />
        <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
          <Area label="Discount rules" name="discount_rules" defaultValue={defaults.discount_rules} placeholder="No discounts, except 5% for orders of 3 or more items." />
          <Field label="Max discount %" name="max_discount_percent" type="number" min={0} max={100} step={1} defaultValue={defaults.max_discount_percent} errors={fe.max_discount_percent} />
        </div>
        <Area
          label="When to hand over to a person"
          name="escalation_rules"
          defaultValue={defaults.escalation_rules}
          placeholder="Custom orders, bulk orders over 10 items, complaints about a delivered order."
          hint="The AI always hands over when it's unsure, the customer asks for a person, or there's a complaint or refund."
        />
      </Section>

      <div className="flex justify-end border-t pt-6">
        <Button type="submit" size="lg" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Save AI settings
        </Button>
      </div>
    </form>
  );
}
