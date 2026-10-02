import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Phone } from "lucide-react";

import { AiModeControl, AssignSelect, ResolveButton } from "@/components/conversations/conversation-controls";
import { Composer } from "@/components/conversations/composer";
import { InboxShell } from "@/components/conversations/inbox-shell";
import { AI_MODE_LABEL, STAGE_LABEL } from "@/components/conversations/labels";
import { MarkRead } from "@/components/conversations/mark-read";
import { NoteForm, TagEditor } from "@/components/conversations/side-panels";
import { Thread } from "@/components/conversations/thread";
import { Badge } from "@/components/ui/badge";
import type { BusinessContext } from "@/lib/auth/session";
import { displayName, timeAgo } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { getConversation, getThread, listAssignableMembers } from "@/services/conversations/conversations.service";
import { getCustomer, getCustomerActivity } from "@/services/customers/customers.service";
import { isWithinServiceWindow } from "@/services/whatsapp/outbound.service";

export const metadata: Metadata = { title: "Conversation" };

const CUSTOMER_STATUS_LABEL: Record<string, string> = {
  lead: "Lead",
  interested: "Interested",
  customer: "Customer",
  repeat_customer: "Repeat customer",
  inactive: "Inactive",
};

async function ConversationView({ ctx, id }: { ctx: BusinessContext; id: string }) {
  const db = await createClient();
  const conversation = await getConversation(db, ctx.business.id, id);
  if (!conversation) notFound();

  const customerRow = conversation.customers as unknown as { id: string };
  const [thread, members, customer, activity, { data: allMembers }, { data: followUp }] = await Promise.all([
    getThread(db, ctx.business.id, id),
    listAssignableMembers(db, ctx.business.id),
    getCustomer(db, ctx.business.id, customerRow.id),
    getCustomerActivity(db, ctx.business.id, customerRow.id, ctx.can("orders.view")),
    db.from("business_members").select("user_id").eq("business_id", ctx.business.id),
    // RLS: visible to members who manage automation.
    db
      .from("follow_ups")
      .select("status, sequence_number, scheduled_for, sent_at")
      .eq("business_id", ctx.business.id)
      .eq("conversation_id", id)
      .in("status", ["scheduled", "sent"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!customer) notFound();

  const { data: profiles } = await db.from("profiles").select("id, full_name, email").in("id", (allMembers ?? []).map((m) => m.user_id));
  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email]));

  const now = new Date();
  const name = displayName(customer);
  const canReply = ctx.can("conversations.reply");
  const closed = conversation.status === "closed";
  const windowOpen = isWithinServiceWindow(conversation.last_customer_message_at, now);
  const number = conversation.whatsapp_accounts as unknown as { display_phone_number: string | null; status: string } | null;

  return (
    <div className="flex h-full">
      <MarkRead conversationId={conversation.id} unread={conversation.unread_count} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-card px-4 py-3">
          <Link href="/conversations" className="md:hidden" aria-label="Back to conversations">
            <ArrowLeft className="size-5" />
          </Link>
          {/* basis keeps the name readable; controls wrap to a second row when space is tight */}
          <div className="min-w-0 flex-1 basis-56">
            <h1 className="truncate font-semibold">{name}</h1>
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <Phone className="size-3" /> {customer.phone}
              </span>
              {number?.display_phone_number && <span className="whitespace-nowrap">· via {number.display_phone_number}</span>}
              {windowOpen ? <span className="whitespace-nowrap text-success">· reply window open</span> : <span className="whitespace-nowrap">· outside 24h window</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AiModeControl conversationId={conversation.id} mode={conversation.ai_mode} disabled={!canReply || closed} />
            <AssignSelect key={conversation.assigned_to ?? "none"} conversationId={conversation.id} assignedTo={conversation.assigned_to} members={members} disabled={!canReply} />
            <ResolveButton conversationId={conversation.id} closed={closed} disabled={!canReply} />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] [background-size:22px_22px]">
          {thread.hasMore && <p className="pt-4 text-center text-xs text-muted-foreground">Showing the latest messages</p>}
          <Thread items={thread.items} names={names} currentUserId={ctx.user.id} now={now} />
        </div>

        <Composer conversationId={conversation.id} aiActive={conversation.ai_mode === "AI_ACTIVE"} windowOpen={windowOpen} closed={closed} canReply={canReply} />
      </div>

      <aside className="hidden w-80 shrink-0 overflow-y-auto border-l bg-card xl:block">
        <section className="border-b p-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold">{name}</div>
              {customer.profile_name && customer.name && customer.profile_name !== customer.name && (
                <div className="text-xs text-muted-foreground">WhatsApp name: {customer.profile_name}</div>
              )}
            </div>
            <Badge variant="secondary">{CUSTOMER_STATUS_LABEL[customer.status] ?? customer.status}</Badge>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Orders</dt>
              <dd className="tabular font-medium">{customer.total_orders}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total spend</dt>
              <dd className="tabular font-medium">{formatMoney(customer.total_spend_minor, ctx.business.currency)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Last seen</dt>
              <dd className="font-medium">{timeAgo(customer.last_interaction_at, now) || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Customer since</dt>
              <dd className="font-medium">{new Date(customer.created_at).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</dd>
            </div>
          </dl>
          {customer.opted_out_at && <p className="mt-3 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">Opted out of automated messages</p>}
          {ctx.can("customers.view") && (
            <Link href={`/customers/${customer.id}`} className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              Full profile <ExternalLink className="size-3" />
            </Link>
          )}
        </section>

        <section className="border-b p-5">
          <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Tags</h2>
          <TagEditor customerId={customer.id} tags={customer.tags} canEdit={ctx.can("customers.manage")} />
        </section>

        <section className="border-b p-5">
          <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Sales</h2>
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Stage</dt>
              <dd className="font-medium">{STAGE_LABEL[conversation.purchase_stage]}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Replies by</dt>
              <dd className="font-medium">{AI_MODE_LABEL[conversation.ai_mode]}</dd>
            </div>
            {followUp && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Follow-up</dt>
                <dd className="font-medium">
                  {followUp.status === "scheduled" ? `#${followUp.sequence_number} due ${timeAgo(followUp.scheduled_for, now)}` : `#${followUp.sequence_number} sent ${timeAgo(followUp.sent_at, now)}`}
                </dd>
              </div>
            )}
          </dl>
          {ctx.can("orders.view") && (
            <div className="mt-4">
              <h3 className="mb-1.5 text-xs text-muted-foreground">Recent orders</h3>
              {activity.orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No orders yet.</p>
              ) : (
                <ul className="grid gap-1.5 text-sm">
                  {activity.orders.slice(0, 5).map((o) => (
                    <li key={o.id} className="flex justify-between gap-2">
                      <span>
                        <Link href={`/orders/${o.id}`} className="hover:underline">
                          #{o.order_number}
                        </Link>{" "}
                        <span className="text-xs text-muted-foreground capitalize">{o.status.replaceAll("_", " ")}</span>
                      </span>
                      <span className="tabular">{formatMoney(o.total_minor, o.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {canReply && (
          <section className="p-5">
            <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Internal note</h2>
            <NoteForm conversationId={conversation.id} />
          </section>
        )}
      </aside>
    </div>
  );
}

export default async function ConversationPage({ params, searchParams }: PageProps<"/conversations/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return (
    <InboxShell searchParams={await searchParams} activeId={id}>
      {(ctx) => <ConversationView ctx={ctx} id={id} />}
    </InboxShell>
  );
}
