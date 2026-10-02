"use client";

import * as React from "react";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { AlertDialog as A } from "radix-ui";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A button that asks for confirmation before running `onConfirm` (usually a
 * server action). Keeps the dialog open with a spinner while it runs.
 */
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  ...buttonProps
}: Omit<React.ComponentProps<typeof Button>, "onClick"> & {
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <A.Root open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <A.Trigger asChild>
        <Button {...buttonProps}>{children}</Button>
      </A.Trigger>
      <A.Portal>
        <A.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <A.Content className="fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-card p-6 shadow-lg">
          <A.Title className="text-lg font-semibold">{title}</A.Title>
          <A.Description className="text-sm text-muted-foreground">{description}</A.Description>
          <div className="flex justify-end gap-2">
            <A.Cancel className={buttonVariants({ variant: "outline" })} disabled={pending}>
              {cancelLabel}
            </A.Cancel>
            <button
              type="button"
              disabled={pending}
              className={cn(buttonVariants({ variant: destructive ? "destructive" : "default" }))}
              onClick={() =>
                startTransition(async () => {
                  await onConfirm();
                  setOpen(false);
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </A.Content>
      </A.Portal>
    </A.Root>
  );
}
