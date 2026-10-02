"use client";

import { useState, useTransition } from "react";
import { Bot, CheckCircle2, Loader2, Pause, RotateCcw, UserRound } from "lucide-react";
import { toast } from "sonner";

import { assignAction, setAiModeAction, setStatusAction } from "@/app/(app)/conversations/actions";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

type Mode = "AI_ACTIVE" | "HUMAN_ACTIVE" | "PAUSED";

function notify(res: { ok: boolean; error?: string; message?: string }) {
  if (res.ok) {
    if (res.message) toast.success(res.message);
  } else toast.error(res.error);
}

export function AiModeControl({ conversationId, mode, disabled }: { conversationId: string; mode: Mode; disabled: boolean }) {
  const [pending, start] = useTransition();
  const options: { value: Mode; label: string; icon: typeof Bot }[] = [
    { value: "AI_ACTIVE", label: "AI", icon: Bot },
    { value: "HUMAN_ACTIVE", label: "Human", icon: UserRound },
    { value: "PAUSED", label: "Paused", icon: Pause },
  ];
  return (
    <div className="flex items-center gap-2">
      <div role="radiogroup" aria-label="Who replies" className={cn("flex rounded-lg border bg-card p-0.5", (pending || disabled) && "opacity-60")}>
        {options.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            disabled={pending || disabled}
            onClick={() => mode !== value && start(async () => notify(await setAiModeAction(conversationId, value)))}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed",
              mode === value ? (value === "AI_ACTIVE" ? "bg-sidebar text-signal" : "bg-primary text-primary-foreground") : "text-muted-foreground hover:bg-muted",
            )}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
  );
}

export function AssignSelect({
  conversationId,
  assignedTo,
  members,
  disabled,
}: {
  conversationId: string;
  assignedTo: string | null;
  members: { id: string; name: string }[];
  disabled: boolean;
}) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState(assignedTo ?? "");
  return (
    <NativeSelect
      aria-label="Assigned to"
      value={value}
      disabled={disabled || pending}
      className="h-8 w-40 text-xs"
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        start(async () => {
          const res = await assignAction(conversationId, next || null);
          notify(res);
          if (!res.ok) setValue(assignedTo ?? "");
        });
      }}
    >
      <option value="">Unassigned</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </NativeSelect>
  );
}

export function ResolveButton({ conversationId, closed, disabled }: { conversationId: string; closed: boolean; disabled: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || pending}
      onClick={() => start(async () => notify(await setStatusAction(conversationId, closed ? "open" : "closed")))}
    >
      {pending ? <Loader2 className="animate-spin" /> : closed ? <RotateCcw /> : <CheckCircle2 />}
      {closed ? "Reopen" : "Resolve"}
    </Button>
  );
}
