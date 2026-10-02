"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/lib/action-types";
import { useFormAction } from "@/lib/use-form-action";

export function BankTransferForm({
  action,
  defaults,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  defaults: { enabled: boolean; bankName: string; accountNumber: string; accountName: string; instructions: string };
}) {
  const { state, pending, formProps } = useFormAction(action);
  const fe = state?.fieldErrors ?? {};
  useEffect(() => {
    if (state?.ok) toast.success(state.message ?? "Saved");
    else if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form {...formProps} autoComplete="off" className="grid gap-4">
      <label className="flex items-start gap-3 rounded-lg border p-4">
        <Checkbox name="enabled" defaultChecked={defaults.enabled} className="mt-0.5" />
        <span>
          <span className="block text-sm font-medium">Let customers pay by bank transfer</span>
          <span className="block text-sm text-muted-foreground">The AI shares these details and collects the customer’s receipt. Your team confirms each payment on the order page.</span>
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bank" name="bankName" defaultValue={defaults.bankName} placeholder="e.g. GTBank, Moniepoint, Opay" errors={fe.bankName} />
        <Field label="Account number" name="accountNumber" inputMode="numeric" maxLength={10} defaultValue={defaults.accountNumber} placeholder="0123456789" errors={fe.accountNumber} data-1p-ignore />
      </div>
      <Field label="Account name" name="accountName" defaultValue={defaults.accountName} placeholder="As it appears on the account" errors={fe.accountName} />
      <div className="grid gap-2">
        <Label htmlFor="bt-instructions">Extra instructions (optional)</Label>
        <Textarea id="bt-instructions" name="instructions" rows={2} defaultValue={defaults.instructions} placeholder="e.g. Transfers are confirmed within 30 minutes during business hours." />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Save bank transfer
        </Button>
      </div>
    </form>
  );
}
