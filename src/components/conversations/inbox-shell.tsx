import { requireBusinessContext, type BusinessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { countNeedsAttention, INBOX_FILTERS, listInbox, type InboxFilter } from "@/services/conversations/conversations.service";
import { cn } from "@/lib/utils";

import { InboxList } from "./inbox-list";
import { RealtimeRefresh } from "./realtime-refresh";

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export async function InboxShell({
  searchParams,
  activeId,
  children,
}: {
  searchParams: Record<string, string | string[] | undefined>;
  activeId?: string;
  children: (ctx: BusinessContext) => React.ReactNode;
}) {
  const ctx = await requireBusinessContext();
  const rawFilter = one(searchParams.filter);
  const filter: InboxFilter = (INBOX_FILTERS as readonly string[]).includes(rawFilter ?? "") ? (rawFilter as InboxFilter) : "all";
  const q = one(searchParams.q)?.slice(0, 80) || undefined;

  const db = await createClient();
  const [items, attentionCount] = await Promise.all([
    listInbox(db, ctx.business.id, { filter, q, userId: ctx.user.id }),
    countNeedsAttention(db, ctx.business.id),
  ]);

  return (
    <div className="-mx-6 -my-8 flex h-[calc(100dvh-3.5rem)] min-h-[520px] overflow-hidden border-b bg-background">
      <RealtimeRefresh businessId={ctx.business.id} />
      <aside className={cn("w-full shrink-0 border-r bg-card md:w-80", activeId && "hidden md:block")}>
        <InboxList items={items} filter={filter} q={q} activeId={activeId} attentionCount={attentionCount} now={new Date()} />
      </aside>
      <section className={cn("min-w-0 flex-1", !activeId && "hidden md:block")}>{children(ctx)}</section>
    </div>
  );
}
