import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bot, ChevronLeft, ChevronRight, Search, ShoppingBag } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { OrderStatusBadge } from "@/components/orders/order-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireBusinessContext } from "@/lib/auth/session";
import { timeAgo } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { listOrders, ORDER_STATUSES } from "@/services/orders/orders.service";

export const metadata: Metadata = { title: "Orders" };

const TABS = [
  { value: "", label: "All" },
  { value: "pending_payment", label: "Awaiting payment" },
  { value: "paid", label: "Paid" },
  { value: "processing", label: "Processing" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const ctx = await requireBusinessContext();
  if (!ctx.can("orders.view")) redirect("/dashboard");
  const sp = await searchParams;
  const status = (ORDER_STATUSES as readonly string[]).includes(one(sp.status) ?? "") ? (one(sp.status) as (typeof ORDER_STATUSES)[number]) : undefined;
  const q = one(sp.q)?.slice(0, 60) || undefined;
  const page = Number(one(sp.page)) || 1;

  const { items, total, pageCount } = await listOrders(await createClient(), ctx.business.id, { status, q, page });
  const now = new Date();
  const href = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { status, q, page: undefined, ...patch };
    Object.entries(merged).forEach(([k, v]) => v !== undefined && v !== "" && !(k === "page" && Number(v) === 1) && p.set(k, String(v)));
    const s = p.toString();
    return s ? `/orders?${s}` : "/orders";
  };

  return (
    <>
      <PageHeader title="Orders" description="Orders created by your AI assistant and your team. They become Paid only when the payment provider confirms it." />

      {total === 0 && !status && !q ? (
        <EmptyState icon={ShoppingBag} title="No orders yet" description="When a customer confirms a purchase on WhatsApp, the order appears here with its items, delivery details and payment status." />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <nav className="flex flex-wrap gap-1 rounded-lg border bg-card p-0.5 text-sm">
              {TABS.map((t) => (
                <Link
                  key={t.value}
                  href={href({ status: t.value || undefined })}
                  className={cn("rounded-md px-3 py-1.5", (status ?? "") === t.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {t.label}
                </Link>
              ))}
            </nav>
            <form action="/orders" className="relative min-w-[220px] flex-1">
              {status && <input type="hidden" name="status" value={status} />}
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={q} placeholder="Order number, customer name or phone" className="pl-8" />
            </form>
          </div>

          {items.length === 0 ? (
            <EmptyState icon={Search} title="No orders match" description="Try another status or search." />
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Order</th>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Items</th>
                    <th className="px-4 py-3 text-right font-medium">Total</th>
                    <th className="px-4 py-3 text-right font-medium">Placed</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((o) => (
                    <tr key={o.id} className="group hover:bg-muted/40">
                      <td className="px-4 py-2.5">
                        <Link href={`/orders/${o.id}`} className="inline-flex items-center gap-1.5 font-medium group-hover:underline">
                          #{o.order_number}
                          {o.ai_assisted && (
                            <span title="Taken by your AI assistant" className="inline-flex items-center gap-0.5 rounded bg-sidebar px-1 py-0.5 text-[10px] text-signal">
                              <Bot className="size-3" /> AI
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <div>{o.customer_name}</div>
                        <div className="text-xs text-muted-foreground">{o.customer_phone}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <OrderStatusBadge status={o.status} />
                      </td>
                      <td className="tabular px-4 py-2.5 text-right">{o.item_count}</td>
                      <td className="tabular px-4 py-2.5 text-right font-medium">{formatMoney(o.total_minor, o.currency)}</td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">{timeAgo(o.created_at, now)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {total.toLocaleString()} orders · page {page} of {pageCount}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={href({ page: page - 1 })}>
                      <ChevronLeft /> Previous
                    </Link>
                  </Button>
                )}
                {page < pageCount && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={href({ page: page + 1 })}>
                      Next <ChevronRight />
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
