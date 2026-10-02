import { AlertCircle, Bot, Check, CheckCheck, Clock, StickyNote, Zap } from "lucide-react";

import { clockTime, dayLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ThreadItem } from "@/services/conversations/conversations.service";

import { ScrollAnchor } from "./scroll-anchor";

function StatusIcon({ status, error }: { status: string; error: string | null }) {
  switch (status) {
    case "queued":
      return <Clock className="size-3.5" aria-label="Sending" />;
    case "sent":
      return <Check className="size-3.5" aria-label="Sent" />;
    case "delivered":
      return <CheckCheck className="size-3.5" aria-label="Delivered" />;
    case "read":
      return <CheckCheck className="size-3.5 text-sky-300" aria-label="Read" />;
    case "failed":
      return (
        <span title={error ?? "Failed"}>
          <AlertCircle className="size-3.5 text-red-200" aria-label="Failed" />
        </span>
      );
    default:
      return null;
  }
}

const EVENT_TEXT: Record<string, (actor: string, data: Record<string, unknown>, names: Map<string, string>) => string> = {
  human_takeover: (a) => `${a} took over from the AI`,
  ai_paused: (a) => `${a} paused the AI`,
  ai_resumed: (a) => `${a} handed the conversation back to the AI`,
  assigned: (a, d, names) => (d.assignee ? `${a} assigned this to ${names.get(String(d.assignee)) ?? "a teammate"}` : `${a} unassigned this conversation`),
  closed: (a) => `${a} resolved this conversation`,
  reopened: (a) => `${a} reopened this conversation`,
  handoff_requested: () => "The AI asked for a human to help",
  stage_changed: (_a, d) => `Stage changed to ${String(d.to ?? "")}`,
  follow_up_sent: (_a, d) => `Automated follow-up #${String(d.sequence_number ?? 1)} sent${d.channel === "template" ? " (template)" : ""}`,
  customer_opted_out: () => "Customer replied STOP — no more automated messages",
  customer_opted_in: () => "Customer replied START — automated messages allowed again",
  payment_claimed: (_a, d) => `Customer says they’ve paid for order #${String(d.order_number ?? "")} by bank transfer${d.with_receipt ? " (receipt attached)" : ""} — confirm it on the order page`,
};

export function Thread({
  items,
  names,
  currentUserId,
  now,
}: {
  items: ThreadItem[];
  names: Map<string, string>;
  currentUserId: string;
  now: Date;
}) {
  // Precompute day separators (render must stay pure).
  const rows = items.map((item, i) => {
    const day = dayLabel(item.at, now);
    return { item, day, newDay: i === 0 || day !== dayLabel(items[i - 1].at, now) };
  });

  return (
    <div className="flex flex-col gap-1.5 px-4 py-4 sm:px-6">
      {items.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No messages yet.</p>}
      {rows.map(({ item, day, newDay }) => {
        const divider =
          newDay ? (
            <div key={`d-${item.id}`} className="my-3 flex items-center gap-3 text-[11px] font-medium text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {day}
              <span className="h-px flex-1 bg-border" />
            </div>
          ) : null;

        if (item.kind === "event") {
          const e = item.event;
          const actor = e.actor_user_id === currentUserId ? "You" : e.actor_user_id ? (names.get(e.actor_user_id) ?? "A teammate") : e.actor_type === "ai" ? "AI" : "SellFlow";
          const data = (e.data ?? {}) as Record<string, unknown>;
          if (e.type === "note") {
            return (
              <div key={item.id}>
                {divider}
                <div className="mx-auto my-1 w-full max-w-md rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                  <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium text-[oklch(0.45_0.1_70)]">
                    <StickyNote className="size-3" /> Note by {actor} · {clockTime(e.created_at)} · only your team sees this
                  </div>
                  <p className="whitespace-pre-wrap">{String(data.text ?? "")}</p>
                </div>
              </div>
            );
          }
          const text = EVENT_TEXT[e.type]?.(actor, data, names) ?? e.type.replaceAll("_", " ");
          return (
            <div key={item.id}>
              {divider}
              <div className="my-1 text-center text-[11px] text-muted-foreground">
                {text} · {clockTime(e.created_at)}
              </div>
            </div>
          );
        }

        const m = item.message;
        const outbound = m.direction === "outbound";
        const who =
          m.sender === "ai" ? "AI" : m.sender === "automation" ? "Automation" : m.sender === "staff" ? (m.sender_user_id === currentUserId ? "You" : (names.get(m.sender_user_id ?? "") ?? "Team")) : null;

        return (
          <div key={item.id}>
            {divider}
            <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-xs",
                  outbound ? "rounded-br-sm" : "rounded-bl-sm border bg-card",
                  outbound && (m.sender === "ai" || m.sender === "automation") && "bg-sidebar text-sidebar-foreground",
                  outbound && m.sender !== "ai" && m.sender !== "automation" && "bg-primary text-primary-foreground",
                  m.status === "failed" && "ring-2 ring-destructive/60",
                )}
              >
                {outbound && who && (
                  <div className={cn("mb-0.5 flex items-center gap-1 text-[11px] font-medium opacity-80")}>
                    {m.sender === "ai" && <Bot className="size-3" />}
                    {m.sender === "automation" && <Zap className="size-3" />}
                    {who}
                  </div>
                )}
                {m.body ? <p className="break-words whitespace-pre-wrap">{m.body}</p> : <p className="italic opacity-70">[{m.type} message]</p>}
                <div className={cn("mt-1 flex items-center justify-end gap-1 text-[10px]", outbound ? "opacity-75" : "text-muted-foreground")}>
                  {clockTime(m.created_at)}
                  {outbound && <StatusIcon status={m.status} error={m.error} />}
                </div>
                {m.status === "failed" && m.error && <p className="mt-1 border-t border-white/20 pt-1 text-[11px] opacity-90">Not delivered: {m.error}</p>}
              </div>
            </div>
          </div>
        );
      })}
      <ScrollAnchor signature={`${items.length}:${items.at(-1)?.id ?? ""}`} />
    </div>
  );
}
