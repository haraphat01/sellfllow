"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import type { ActionResult } from "@/lib/action-types";

export function ChoosePlanButton({
  code,
  label,
  variant = "default",
  confirm,
  action,
}: {
  code: string;
  label: string;
  variant?: "default" | "outline";
  /** Shown in a confirmation dialog first (downgrades, saved-card upgrades). */
  confirm?: { title: string; description: string };
  action: (code: string) => Promise<ActionResult<{ url?: string }>>;
}) {
  const [pending, start] = useTransition();
  const run = () =>
    new Promise<void>((resolve) =>
      start(async () => {
        const res = await action(code);
        if (!res.ok) toast.error(res.error);
        else if (res.data?.url) {
          toast.message("Redirecting to Paystack…");
          window.location.assign(res.data.url);
        } else toast.success(res.message ?? "Done");
        resolve();
      }),
    );

  if (confirm) {
    return (
      <ConfirmButton className="w-full" variant={variant} title={confirm.title} description={confirm.description} confirmLabel={label} onConfirm={run}>
        {label}
      </ConfirmButton>
    );
  }
  return (
    <Button className="w-full" variant={variant} disabled={pending} onClick={() => void run()}>
      {pending && <Loader2 className="animate-spin" />} {label}
    </Button>
  );
}

export function SimpleAction({
  label,
  action,
  confirm,
  destructive = false,
}: {
  label: string;
  action: () => Promise<ActionResult>;
  confirm: { title: string; description: string; confirmLabel: string };
  destructive?: boolean;
}) {
  return (
    <ConfirmButton
      variant="outline"
      size="sm"
      destructive={destructive}
      title={confirm.title}
      description={confirm.description}
      confirmLabel={confirm.confirmLabel}
      cancelLabel="Keep it"
      onConfirm={async () => {
        const res = await action();
        if (res.ok) toast.success(res.message ?? "Done");
        else toast.error(res.error);
      }}
    >
      {label}
    </ConfirmButton>
  );
}
