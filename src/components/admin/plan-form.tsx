"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { FormState } from "@/lib/action-types";
import { useFormAction } from "@/lib/use-form-action";

const LIMITS: [string, string][] = [
  ["monthly_ai_conversations", "AI conversations / month"],
  ["messages", "Messages / month"],
  ["orders", "Orders / month"],
  ["customers", "Customers"],
  ["products", "Products"],
  ["staff", "Team members"],
  ["whatsapp_numbers", "WhatsApp numbers"],
  ["campaigns", "Campaigns"],
];
const FEATURES: [string, string][] = [
  ["follow_ups", "Follow-ups"],
  ["campaigns", "Campaigns"],
  ["advanced_analytics", "Advanced analytics"],
  ["api", "API"],
  ["priority_support", "Priority support"],
];

export type PlanDefaults = {
  id: string | null;
  code: string;
  name: string;
  description: string;
  price: string;
  interval: string;
  sort_order: number;
  is_active: boolean;
  is_public: boolean;
  limits: Record<string, number | null>;
  features: Record<string, boolean>;
};

export function PlanForm({ plan, action, subscribers }: { plan: PlanDefaults; action: (s: FormState, f: FormData) => Promise<FormState>; subscribers: number }) {
  const { state, pending, formProps } = useFormAction(action);
  const fe = state?.fieldErrors ?? {};
  useEffect(() => {
    if (state?.ok) toast.success(state.message ?? "Saved");
    else if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form {...formProps} autoComplete="off" className="grid gap-5">
      {plan.id && <input type="hidden" name="id" value={plan.id} />}
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_140px_140px_90px]">
        <Field label="Code" name="code" defaultValue={plan.code} readOnly={Boolean(plan.id)} errors={fe.code} hint={plan.id ? <span className="text-xs text-muted-foreground">fixed</span> : undefined} />
        <Field label="Name" name="name" defaultValue={plan.name} errors={fe.name} />
        <Field label="Price (₦)" name="price" inputMode="decimal" defaultValue={plan.price} errors={fe.price} />
        <div className="grid gap-2">
          <Label htmlFor={`interval-${plan.code}`}>Billed</Label>
          <NativeSelect id={`interval-${plan.code}`} name="interval" defaultValue={plan.interval}>
            <option value="monthly">Monthly</option>
            <option value="annually">Yearly</option>
          </NativeSelect>
        </div>
        <Field label="Order" name="sort_order" type="number" min={0} defaultValue={plan.sort_order} errors={fe.sort_order} />
      </div>
      <Field label="Description" name="description" defaultValue={plan.description} errors={fe.description} />

      <div>
        <h4 className="mb-2 text-sm font-medium">Limits <span className="font-normal text-muted-foreground">— empty means unlimited</span></h4>
        <div className="grid gap-3 sm:grid-cols-4">
          {LIMITS.map(([k, label]) => (
            <Field key={k} label={label} name={`limit_${k}`} inputMode="numeric" defaultValue={plan.limits[k] ?? ""} placeholder="Unlimited" errors={fe[`limits.${k}`]} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {FEATURES.map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <Checkbox name={`feature_${k}`} defaultChecked={plan.features[k] ?? false} /> {label}
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="is_active" defaultChecked={plan.is_active} /> Active (can be purchased)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="is_public" defaultChecked={plan.is_public} /> Shown on the Billing page
          </label>
          {plan.id && <span className="text-sm text-muted-foreground">{subscribers} current subscriber{subscribers === 1 ? "" : "s"}</span>}
        </div>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} {plan.id ? "Save plan" : "Create plan"}
        </Button>
      </div>
    </form>
  );
}
