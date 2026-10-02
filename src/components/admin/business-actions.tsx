"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-types";

/** A dialog that collects the fields an admin action needs (always including a reason) and runs it. */
function ActionDialog({
  trigger,
  title,
  description,
  confirmLabel,
  destructive = false,
  fields,
  run,
}: {
  trigger: string;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  fields?: (state: Record<string, string>, set: (k: string, v: string) => void) => React.ReactNode;
  run: (state: Record<string, string>) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Record<string, string>>({ reason: "" });
  const [pending, start] = useTransition();
  const set = (k: string, v: string) => setState((s) => ({ ...s, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={destructive ? "destructive" : "outline"} size="sm">
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {fields?.(state, set)}
          <div className="grid gap-2">
            <Label htmlFor="admin-reason">Reason (audit log)</Label>
            <Textarea id="admin-reason" rows={2} value={state.reason} onChange={(e) => set("reason", e.target.value)} placeholder="e.g. Partner deal agreed with Aisha on 30 Sep" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await run(state);
                if (res.ok) {
                  toast.success(res.message ?? "Done");
                  setOpen(false);
                  setState({ reason: "" });
                } else toast.error(res.error);
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />} {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BusinessAdminActions({
  businessId,
  businessName,
  suspended,
  canExtendTrial,
  plans,
  actions,
}: {
  businessId: string;
  businessName: string;
  suspended: boolean;
  canExtendTrial: boolean;
  plans: { code: string; name: string }[];
  actions: {
    setSuspended: (i: { businessId: string; suspend: boolean; reason: string }) => Promise<ActionResult>;
    grantPlan: (i: { businessId: string; planCode: string; days: number; reason: string }) => Promise<ActionResult>;
    extendTrial: (i: { businessId: string; days: number; reason: string }) => Promise<ActionResult>;
  };
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionDialog
        trigger="Grant plan"
        title={`Grant a plan to ${businessName}`}
        description="Complimentary: no payment is taken, it isn't counted as revenue, and it ends at the end of the period (the business can subscribe any time)."
        confirmLabel="Grant plan"
        fields={(s, set) => (
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="grant-plan">Plan</Label>
              <NativeSelect id="grant-plan" value={s.planCode ?? plans[0]?.code ?? ""} onChange={(e) => set("planCode", e.target.value)}>
                {plans.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="grant-days">Days</Label>
              <Input id="grant-days" type="number" min={1} max={366} value={s.days ?? "30"} onChange={(e) => set("days", e.target.value)} />
            </div>
          </div>
        )}
        run={(s) => actions.grantPlan({ businessId, planCode: s.planCode ?? plans[0]?.code ?? "", days: Number(s.days ?? 30), reason: s.reason })}
      />
      {canExtendTrial && (
        <ActionDialog
          trigger="Extend trial"
          title="Extend the free trial"
          description="Adds days to the trial (or restarts an expired one)."
          confirmLabel="Extend trial"
          fields={(s, set) => (
            <div className="grid gap-2">
              <Label htmlFor="trial-days">Days to add</Label>
              <Input id="trial-days" type="number" min={1} max={90} value={s.days ?? "7"} onChange={(e) => set("days", e.target.value)} />
            </div>
          )}
          run={(s) => actions.extendTrial({ businessId, days: Number(s.days ?? 7), reason: s.reason })}
        />
      )}
      {suspended ? (
        <ActionDialog
          trigger="Reinstate"
          title={`Reinstate ${businessName}?`}
          description="The dashboard, AI assistant and automations start working again."
          confirmLabel="Reinstate"
          run={(s) => actions.setSuspended({ businessId, suspend: false, reason: s.reason })}
        />
      ) : (
        <ActionDialog
          trigger="Suspend"
          destructive
          title={`Suspend ${businessName}?`}
          description="Team members can no longer make changes, and the AI assistant, follow-ups and renewals stop. Incoming WhatsApp messages are still stored. The owner is notified with your reason."
          confirmLabel="Suspend business"
          run={(s) => actions.setSuspended({ businessId, suspend: true, reason: s.reason })}
        />
      )}
    </div>
  );
}
