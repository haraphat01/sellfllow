"use client";

import { useState, useTransition } from "react";
import { Loader2, PackageCheck, Truck, XCircle } from "lucide-react";
import { toast } from "sonner";

import { advanceOrderAction, cancelOrderAction, updateOrderNotesAction } from "@/app/(app)/orders/actions";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

function notify(res: { ok: boolean; error?: string; message?: string }) {
  if (res.ok) toast.success(res.message ?? "Done");
  else toast.error(res.error);
}

const NEXT: Record<string, { to: "processing" | "shipped" | "delivered"; label: string; icon: typeof Truck }> = {
  paid: { to: "processing", label: "Start processing", icon: PackageCheck },
  processing: { to: "shipped", label: "Mark shipped", icon: Truck },
  shipped: { to: "delivered", label: "Mark delivered", icon: PackageCheck },
};

export function OrderActions({ orderId, orderNumber, status, paid }: { orderId: string; orderNumber: number; status: string; paid: boolean }) {
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const next = NEXT[status];
  const cancellable = !paid && (status === "pending_payment" || status === "draft");

  return (
    <div className="flex flex-wrap items-center gap-2">
      {next && (
        <Button disabled={pending} onClick={() => start(async () => notify(await advanceOrderAction(orderId, next.to)))}>
          {pending ? <Loader2 className="animate-spin" /> : <next.icon />} {next.label}
        </Button>
      )}
      {cancellable && (
        <ConfirmButton
          variant="outline"
          destructive
          title={`Cancel order #${orderNumber}?`}
          description={
            <span className="grid gap-3">
              <span>The reserved stock goes back into your inventory. The customer isn’t messaged automatically.</span>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. customer changed their mind" aria-label="Cancellation reason" />
            </span>
          }
          confirmLabel="Cancel order"
          cancelLabel="Keep order"
          onConfirm={async () => notify(await cancelOrderAction(orderId, reason))}
        >
          <XCircle /> Cancel order
        </ConfirmButton>
      )}
    </div>
  );
}

export function OrderNotes({ orderId, notes, canEdit }: { orderId: string; notes: string | null; canEdit: boolean }) {
  const [value, setValue] = useState(notes ?? "");
  const [pending, start] = useTransition();
  if (!canEdit) return <p className="text-sm whitespace-pre-wrap text-muted-foreground">{notes || "No notes."}</p>;
  return (
    <form
      // POST, never GET, if submitted before hydration (keeps text out of URLs)
      method="post"
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => notify(await updateOrderNotesAction(orderId, value)));
      }}
    >
      <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} maxLength={2000} placeholder="Internal notes (packing, courier, tracking number…)" aria-label="Order notes" />
      <Button type="submit" variant="outline" size="sm" className="justify-self-end" disabled={pending || value === (notes ?? "")}>
        {pending && <Loader2 className="animate-spin" />} Save notes
      </Button>
    </form>
  );
}
