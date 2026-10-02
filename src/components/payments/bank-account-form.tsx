"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionResult } from "@/lib/action-types";

type Verified = { accountName: string; bankName: string };

/**
 * Two steps: look the account up with Paystack and show the holder's name,
 * then the owner confirms. Any edit clears the verification.
 */
export function BankAccountForm({
  banks,
  replacing,
  verify,
  connect,
}: {
  banks: { name: string; code: string }[];
  replacing: boolean;
  verify: (i: { bankCode: string; accountNumber: string }) => Promise<ActionResult<Verified>>;
  connect: (i: { bankCode: string; accountNumber: string }) => Promise<ActionResult>;
}) {
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [verified, setVerified] = useState<Verified | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [saving, startSave] = useTransition();

  const edit = (fn: () => void) => {
    fn();
    setVerified(null);
    setError(null);
  };
  const ready = bankCode && /^[0-9]{10}$/.test(accountNumber);

  return (
    <form
      method="post"
      autoComplete="off"
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        startCheck(async () => {
          const res = await verify({ bankCode, accountNumber });
          if (res.ok && res.data) setVerified(res.data);
          else setError(res.ok ? "Couldn't verify this account." : res.error);
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
        <div className="grid gap-2">
          <Label htmlFor="payout-bank">Bank</Label>
          <NativeSelect id="payout-bank" value={bankCode} onChange={(e) => edit(() => setBankCode(e.target.value))}>
            <option value="">Choose your bank…</option>
            {banks.map((b) => (
              <option key={`${b.code}-${b.name}`} value={b.code}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="payout-account">Account number</Label>
          <Input
            id="payout-account"
            inputMode="numeric"
            maxLength={10}
            placeholder="0123456789"
            value={accountNumber}
            onChange={(e) => edit(() => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10)))}
            data-1p-ignore
            data-lpignore="true"
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {verified ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/40 bg-success/10 p-4">
          <div className="flex items-start gap-2 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 text-success" />
            <div>
              <div className="font-medium">{verified.accountName}</div>
              <div className="text-muted-foreground">
                {verified.bankName} · {accountNumber}
              </div>
            </div>
          </div>
          <ConfirmButton
            title={replacing ? "Change your payout account?" : "Use this account for payouts?"}
            description={`Customer payments will be settled by Paystack to ${verified.accountName} at ${verified.bankName}. Only use an account you or your business own.`}
            confirmLabel="Use this account"
            disabled={saving}
            onConfirm={() =>
              new Promise<void>((resolve) =>
                startSave(async () => {
                  const res = await connect({ bankCode, accountNumber });
                  if (res.ok) {
                    toast.success(res.message ?? "Saved");
                    setVerified(null);
                    setAccountNumber("");
                  } else toast.error(res.error);
                  resolve();
                }),
              )
            }
          >
            {saving && <Loader2 className="animate-spin" />} Use this account
          </ConfirmButton>
        </div>
      ) : (
        <div>
          <Button type="submit" variant="outline" disabled={!ready || checking}>
            {checking && <Loader2 className="animate-spin" />} Verify account
          </Button>
        </div>
      )}
    </form>
  );
}
