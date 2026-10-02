import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, MessagesSquare } from "lucide-react";

import { AI_MODE_LABEL } from "@/components/conversations/labels";
import { TagEditor } from "@/components/conversations/side-panels";
import { CustomerForm } from "@/components/customers/customer-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireBusinessContext } from "@/lib/auth/session";
import { displayName, timeAgo } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { getCustomer, getCustomerActivity } from "@/services/customers/customers.service";

import { updateCustomerAction } from "../actions";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params;
  const ctx = await requireBusinessContext();
  if (!ctx.can("customers.view")) redirect("/dashboard");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const db = await createClient();
  const customer = await getCustomer(db, ctx.business.id, id);
  if (!customer) notFound();
  const activity = await getCustomerActivity(db, ctx.business.id, id, ctx.can("orders.view"));
  const now = new Date();
  const name = displayName(customer);
  const openConversation = activity.conversations.find((c) => c.status === "open");
  const address = (customer.address as { line1?: string } | null)?.line1 ?? null;

  return (
    <>
      <Link href="/customers" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Customers
      </Link>
      <PageHeader
        title={name}
        description={`${customer.phone}${customer.profile_name && customer.profile_name !== name ? ` · WhatsApp name: ${customer.profile_name}` : ""}`}
        actions={
          openConversation &&
          ctx.can("conversations.view") && (
            <Button asChild>
              <Link href={`/conversations/${openConversation.id}`}>
                <MessagesSquare /> Open conversation
              </Link>
            </Button>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Orders" value={customer.total_orders.toLocaleString()} />
        <StatCard label="Total spend" value={formatMoney(customer.total_spend_minor, ctx.business.currency)} emphasis />
        <StatCard label="Last interaction" value={timeAgo(customer.last_interaction_at, now) || "—"} hint={customer.last_purchase_at ? `Last purchase ${timeAgo(customer.last_purchase_at, now)}` : "No purchases yet"} />
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_360px]">
        <section className="rounded-xl border bg-card p-6">
          <h2 className="mb-4 font-semibold">Details</h2>
          {ctx.can("customers.manage") ? (
            <CustomerForm
              action={updateCustomerAction.bind(null, customer.id)}
              defaults={{ name: customer.name, email: customer.email, address, notes: customer.notes, status: customer.status }}
            />
          ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd>{customer.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Address</dt>
                <dd>{address ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Notes</dt>
                <dd className="whitespace-pre-wrap">{customer.notes ?? "—"}</dd>
              </div>
            </dl>
          )}
          {customer.opted_out_at && (
            <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Opted out of automated messages on {new Date(customer.opted_out_at).toLocaleDateString("en-GB")}.
            </p>
          )}
        </section>

        <div className="grid gap-6">
          <section className="rounded-xl border bg-card p-5">
            <h2 className="mb-3 font-semibold">Tags</h2>
            <TagEditor customerId={customer.id} tags={customer.tags} canEdit={ctx.can("customers.manage")} />
          </section>

          {ctx.can("conversations.view") && (
            <section className="rounded-xl border bg-card">
              <h2 className="border-b px-5 py-3 font-semibold">Conversations</h2>
              {activity.conversations.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted-foreground">None yet.</p>
              ) : (
                <ul className="divide-y">
                  {activity.conversations.map((c) => (
                    <li key={c.id}>
                      <Link href={`/conversations/${c.id}`} className="block px-5 py-3 hover:bg-muted/50">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate">{c.last_message_preview || "No messages"}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(c.last_message_at, now)}</span>
                        </div>
                        <div className="mt-1 flex gap-1.5">
                          <Badge variant={c.status === "open" ? "success" : "secondary"} className="capitalize">
                            {c.status === "closed" ? "Resolved" : "Open"}
                          </Badge>
                          <Badge variant="outline">{AI_MODE_LABEL[c.ai_mode]}</Badge>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {ctx.can("orders.view") && (
            <section className="rounded-xl border bg-card">
              <h2 className="border-b px-5 py-3 font-semibold">Orders</h2>
              {activity.orders.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted-foreground">No orders yet.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {activity.orders.map((o) => (
                    <li key={o.id} className="flex items-center justify-between px-5 py-3">
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
            </section>
          )}
        </div>
      </div>
    </>
  );
}
