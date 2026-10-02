"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/action-types";
import { useFormAction } from "@/lib/use-form-action";

export function SettingsForm({
  action,
  defaults,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  defaults: { trial_days: number; commission_percent: number; commission_flat_minor: number };
}) {
  const { state, pending, formProps } = useFormAction(action);
  const fe = state?.fieldErrors ?? {};
  useEffect(() => {
    if (state?.ok) toast.success(state.message ?? "Saved");
    else if (state?.error) toast.error(state.error);
  }, [state]);
  return (
    <form {...formProps} className="grid gap-6">
      <div>
        <h3 className="text-sm font-medium">Trials</h3>
        <p className="mt-1 text-sm text-muted-foreground">Length of the free Starter trial for new businesses. Existing trials aren’t changed.</p>
        <div className="mt-3 w-40">
          <Field label="Trial length (days)" name="trial_days" type="number" min={0} max={90} defaultValue={defaults.trial_days} errors={fe.trial_days} />
        </div>
      </div>
      <div className="border-t pt-5">
        <h3 className="text-sm font-medium">Fee on bank-payout sales</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          SellFlow’s cut of each sale collected for merchants who use bank payouts (Paystack subaccounts). Paystack’s own fee is charged to the merchant’s share. Applies to new
          payment links; merchants see it on their Payments page.
        </p>
        <div className="mt-3 grid max-w-md grid-cols-2 gap-3">
          <Field label="Percent of sale" name="commission_percent" type="number" min={0} max={20} step={0.1} defaultValue={defaults.commission_percent} errors={fe.commission_percent} />
          <Field label="Plus flat fee (₦)" name="commission_flat" inputMode="decimal" defaultValue={defaults.commission_flat_minor / 100} errors={fe.commission_flat} />
        </div>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Save settings
        </Button>
      </div>
    </form>
  );
}
