"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronDown, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { connectManualAction, disconnectAction, registerNumberAction, sendTestMessageAction } from "@/app/(app)/settings/whatsapp/actions";
import { Field } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import { useFormAction } from "@/lib/use-form-action";

export function DisconnectButton({ accountId, number }: { accountId: string; number: string }) {
  return (
    <ConfirmButton
      variant="ghost"
      size="sm"
      destructive
      title={`Disconnect ${number}?`}
      description="SellFlow will stop receiving and sending messages for this number immediately. Conversations and customers are kept. You can reconnect later."
      confirmLabel="Disconnect"
      onConfirm={async () => {
        const res = await disconnectAction(accountId);
        if (res.ok) toast.success(res.message ?? "Disconnected");
        else toast.error(res.error);
      }}
    >
      Disconnect
    </ConfirmButton>
  );
}

/** Finish Cloud API registration with the number's own two-step verification PIN. */
export function RegisterNumberForm({ accountId }: { accountId: string }) {
  const [pin, setPin] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      method="post"
      autoComplete="off"
      className="grid gap-3 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await registerNumberAction({ accountId, pin });
          if (res.ok) {
            toast.success(res.message);
            setPin("");
          } else toast.error(res.error);
        });
      }}
    >
      <div>
        <div className="text-sm font-medium">Finish registration</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter this number’s 6-digit two-step verification PIN. Forgot it? In WhatsApp Manager open Account tools → Phone numbers → this number → Settings → Two-step
          verification to change it, then enter the new PIN here.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          maxLength={6}
          placeholder="6-digit PIN"
          aria-label="Two-step verification PIN"
          className="w-36 font-mono tracking-widest [-webkit-text-security:disc]"
          data-1p-ignore
          data-lpignore="true"
        />
        <Button type="submit" disabled={pending || pin.length !== 6}>
          {pending && <Loader2 className="animate-spin" />} Register number
        </Button>
      </div>
    </form>
  );
}

export function TestMessageForm({ accountId }: { accountId: string }) {
  const [to, setTo] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      // POST, never GET, if submitted before hydration (keeps text out of URLs)
      method="post"
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await sendTestMessageAction({ accountId, to });
          if (res.ok) toast.success(res.message);
          else toast.error(res.error);
        });
      }}
    >
      <Input value={to} onChange={(e) => setTo(e.target.value)} type="tel" placeholder="Your WhatsApp number, e.g. +234 803 000 0000" className="max-w-xs" required aria-label="Test recipient" />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Send />} Send test
      </Button>
    </form>
  );
}

export function ManualConnectForm() {
  const [open, setOpen] = useState(false);
  const { state, pending, formProps } = useFormAction(connectManualAction);
  const fe = state?.fieldErrors ?? {};

  useEffect(() => {
    if (state?.ok) toast.success(state.message ?? "Connected");
    else if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <div className="rounded-xl border bg-card">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-6 py-4 text-left" aria-expanded={open}>
        <div>
          <div className="text-sm font-semibold">Advanced: connect with an access token</div>
          <div className="text-sm text-muted-foreground">For developers using their own Meta app or a test number.</div>
        </div>
        <ChevronDown className={open ? "size-4 rotate-180 transition-transform" : "size-4 transition-transform"} />
      </button>
      {open && (
        // Not a login form: keep browsers from autofilling or offering to save the token as a password.
        <form {...formProps} autoComplete="off" data-lpignore="true" data-1p-ignore className="grid gap-4 border-t px-6 py-5">
          <p className="text-sm text-muted-foreground">
            In Meta Business Manager, create a System User with <code className="rounded bg-muted px-1">whatsapp_business_messaging</code> and{" "}
            <code className="rounded bg-muted px-1">whatsapp_business_management</code> permissions, generate a token, and copy the IDs from WhatsApp Manager → API Setup. The
            token is encrypted and never shown again.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="WhatsApp Business Account ID" name="wabaId" inputMode="numeric" autoComplete="off" required errors={fe.wabaId} />
            <Field label="Phone number ID" name="phoneNumberId" inputMode="numeric" autoComplete="off" required errors={fe.phoneNumberId} />
          </div>
          <Field
            label="Access token"
            name="accessToken"
            type="text"
            autoComplete="off"
            spellCheck={false}
            data-lpignore="true"
            data-1p-ignore
            className="font-mono [-webkit-text-security:disc]"
            required
            errors={fe.accessToken}
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Connect number
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
