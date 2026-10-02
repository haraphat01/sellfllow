"use client";

import { useState, useTransition } from "react";
import { Link2, Loader2, RefreshCw, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { checkPaymentAction, paymentLinkAction, refundOrderAction } from "@/app/(app)/orders/actions";
import { CopyField } from "@/components/ui/copy-field";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";

export function PaymentActions({
  orderId,
  status,
  paystackConnected,
  canManage,
  canRefund,
  refundRequested,
  bankTransfer = false,
}: {
  orderId: string;
  status: string;
  paystackConnected: boolean;
  canManage: boolean;
  canRefund: boolean;
  refundRequested: boolean;
  bankTransfer?: boolean;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const awaiting = status === "pending_payment";

  if (!paystackConnected) {
    return awaiting && !bankTransfer ? <p className="px-6 pb-4 text-sm text-muted-foreground">Set up payments in Settings → Payments to collect payment for orders.</p> : null;
  }

  return (
    <div className="grid gap-3 px-6 pb-5">
      <div className="flex flex-wrap gap-2">
        {awaiting && canManage && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await paymentLinkAction(orderId);
                if (res.ok) {
                  setLink(res.url);
                  toast.success(res.reused ? "Existing payment link" : "Payment link created");
                } else toast.error(res.error);
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <Link2 />} Payment link
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await checkPaymentAction(orderId);
              if (res.ok) toast.success(res.message);
              else toast.error(res.error);
            })
          }
        >
          <RefreshCw /> Check payment
        </Button>
        {canRefund && !refundRequested && (
          <ConfirmButton
            variant="outline"
            size="sm"
            destructive
            title="Refund this order?"
            description="Paystack refunds the full amount to the customer. The order becomes Refunded when Paystack confirms it. Stock isn't returned automatically."
            confirmLabel="Refund"
            cancelLabel="Don't refund"
            onConfirm={async () => {
              const res = await refundOrderAction(orderId);
              if (res.ok) toast.success(res.message);
              else toast.error(res.error);
            }}
          >
            <Undo2 /> Refund
          </ConfirmButton>
        )}
      </div>
      {refundRequested && <p className="text-sm text-muted-foreground">Refund requested — waiting for Paystack to complete it.</p>}
      {link && <CopyField value={link} label="Payment link" />}
    </div>
  );
}
