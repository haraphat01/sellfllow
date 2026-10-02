"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/lib/action-types";
import { useFormAction } from "@/lib/use-form-action";

const STATUSES = [
  ["lead", "Lead"],
  ["interested", "Interested"],
  ["customer", "Customer"],
  ["repeat_customer", "Repeat customer"],
  ["inactive", "Inactive"],
] as const;

export function CustomerForm({
  action,
  defaults,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  defaults: { name: string | null; email: string | null; address: string | null; notes: string | null; status: string };
}) {
  const { state, pending, formProps } = useFormAction(action);
  const fe = state?.fieldErrors ?? {};

  useEffect(() => {
    if (state?.ok) toast.success(state.message ?? "Saved");
    else if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form {...formProps} autoComplete="off" className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" defaultValue={defaults.name ?? ""} placeholder="As the customer should be addressed" errors={fe.name} />
        <Field label="Email" name="email" type="email" defaultValue={defaults.email ?? ""} errors={fe.email} />
      </div>
      <Field label="Delivery address" name="address" defaultValue={defaults.address ?? ""} errors={fe.address} />
      <div className="grid gap-2 sm:max-w-xs">
        <Label htmlFor="f-status">Status</Label>
        <NativeSelect id="f-status" name="status" defaultValue={defaults.status}>
          {STATUSES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="f-notes">Notes</Label>
        <Textarea id="f-notes" name="notes" defaultValue={defaults.notes ?? ""} rows={3} placeholder="Preferences, sizes, anything your team should know" />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Save customer
        </Button>
      </div>
    </form>
  );
}
