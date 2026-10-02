"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Landmark, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { confirmBankTransferAction, rejectBankTransferAction } from "@/app/(app)/orders/actions";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Bank transfer on the order page: what the customer claimed, their receipt,
 * and the human-only Confirm / Not received decision.
 */
export function BankTransferCard({
  orderId,
  amount,
  narration,
  account,
  claimedAt,
  receiptUrl,
  rejectionNote,
  canManage,
}: {
  orderId: string;
  amount: string;
  narration: string;
  account: string | null;
  claimedAt: string | null;
  receiptUrl: string | null;
  rejectionNote: string | null;
  canManage: boolean;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  return (
    <div className="mx-6 mb-4 grid gap-3 rounded-lg border p-4">
      <div className="flex items-start gap-2 text-sm">
        <Landmark className="mt-0.5 size-4 shrink-0 text-primary" />
        <div>
          {claimedAt ? (
            <div className="font-medium">
              The customer says they’ve paid {amount} by bank transfer ({new Date(claimedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}).
            </div>
          ) : (
            <div className="font-medium">Awaiting bank transfer of {amount}.</div>
          )}
          <div className="text-muted-foreground">
            Narration: <span className="font-mono">{narration}</span>
            {account ? <> · To {account}</> : null}
          </div>
          {rejectionNote && !claimedAt && <div className="mt-1 text-xs text-muted-foreground">Last check: not received — {rejectionNote}</div>}
        </div>
      </div>

      {receiptUrl && (
        <a href={receiptUrl} target="_blank" rel="noreferrer" className="w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element -- private, authenticated media stream */}
          <img src={receiptUrl} alt="Transfer receipt sent by the customer" className="max-h-72 rounded-md border object-contain" />
          <span className="mt-1 block text-xs text-primary hover:underline">Open receipt</span>
        </a>
      )}
      {claimedAt && !receiptUrl && <p className="text-sm text-muted-foreground">No receipt was sent. Check your bank for {amount} with the narration above.</p>}

      {canManage && (
        <>
          <p className="text-xs text-muted-foreground">
            Receipts can be faked — only confirm after you see {amount} in your bank account.
          </p>
          {rejecting ? (
            <div className="grid gap-2">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note for your team (not sent to the customer)" />
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await rejectBankTransferAction(orderId, note);
                      if (res.ok) {
                        toast.success(res.message ?? "Marked as not received");
                        setRejecting(false);
                        setNote("");
                      } else toast.error(res.error);
                    })
                  }
                >
                  {pending && <Loader2 className="animate-spin" />} Tell the customer it wasn’t received
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setRejecting(false)}>
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <ConfirmButton
                size="sm"
                title={`Confirm you received ${amount}?`}
                description="The order becomes Paid and the customer gets a WhatsApp confirmation. Only confirm after checking your bank account — this is recorded with your name."
                confirmLabel="Yes, I received it"
                onConfirm={async () => {
                  const res = await confirmBankTransferAction(orderId);
                  if (res.ok) toast.success(res.message ?? "Confirmed");
                  else toast.error(res.error);
                }}
              >
                <CheckCircle2 /> Confirm payment received
              </ConfirmButton>
              {claimedAt && (
                <Button variant="outline" size="sm" onClick={() => setRejecting(true)}>
                  <XCircle /> Not received
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
