import Link from "next/link";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { displayName, initials, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InboxFilter, InboxItem } from "@/services/conversations/conversations.service";

import { AI_MODE_LABEL, inboxStatus } from "./labels";

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: "all", label: "Open" },
  { value: "attention", label: "Needs you" },
  { value: "mine", label: "Mine" },
  { value: "unassigned", label: "Unassigned" },
  { value: "ai", label: "AI" },
  { value: "human", label: "Human" },
  { value: "closed", label: "Resolved" },
];

const TONE = {
  danger: "text-destructive",
  warning: "text-[oklch(0.5_0.12_70)]",
  success: "text-success",
  muted: "text-muted-foreground",
} as const;

export function InboxList({
  items,
  filter,
  q,
  activeId,
  attentionCount,
  now,
}: {
  items: InboxItem[];
  filter: InboxFilter;
  q?: string;
  activeId?: string;
  attentionCount: number;
  now: Date;
}) {
  const qs = (f: InboxFilter) => {
    const p = new URLSearchParams();
    if (f !== "all") p.set("filter", f);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b p-3">
        <form action={activeId ? `/conversations/${activeId}` : "/conversations"} className="relative">
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q} placeholder="Search name or phone" className="pl-8" aria-label="Search conversations" />
        </form>
        <nav className="mt-3 flex gap-1 overflow-x-auto text-xs" aria-label="Filter conversations">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={`${activeId ? `/conversations/${activeId}` : "/conversations"}${qs(f.value)}`}
              aria-current={filter === f.value ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 whitespace-nowrap",
                filter === f.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {f.label}
              {f.value === "attention" && attentionCount > 0 && (
                <span className={cn("rounded-full px-1.5 text-[10px] font-semibold", filter === f.value ? "bg-white/20" : "bg-destructive text-white")}>{attentionCount}</span>
              )}
            </Link>
          ))}
        </nav>
      </div>

      {items.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">{q ? "No conversations match your search." : "Nothing here."}</div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {items.map((c) => {
            const name = displayName(c.customer);
            const status = inboxStatus(c);
            const active = c.id === activeId;
            return (
              <li key={c.id}>
                <Link
                  href={`/conversations/${c.id}${qs(filter)}`}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex gap-3 border-b px-3 py-3 transition-colors", active ? "bg-accent/60" : "hover:bg-muted/60")}
                >
                  <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
                    {initials(name)}
                    {c.aiMode === "AI_ACTIVE" && c.status === "open" && (
                      <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-card bg-signal" title="AI active" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-sm", c.unreadCount > 0 ? "font-semibold" : "font-medium")}>{name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(c.lastMessageAt, now)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className={cn("truncate text-xs", status ? TONE[status.tone] : "text-muted-foreground", status?.tone === "danger" && "font-medium")}>
                        {status?.label ?? (c.lastMessagePreview || "No messages yet")}
                      </span>
                      {c.unreadCount > 0 && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                          {c.unreadCount}
                        </span>
                      )}
                    </span>
                    {status && c.lastMessagePreview && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{c.lastMessagePreview}</span>}
                    {c.aiMode !== "AI_ACTIVE" && c.status === "open" && (
                      <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{AI_MODE_LABEL[c.aiMode]}</span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
