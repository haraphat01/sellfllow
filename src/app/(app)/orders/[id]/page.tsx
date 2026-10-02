import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Bot, MessagesSquare } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { OrderActions, OrderNotes } from "@/components/orders/order-actions";
import { OrderStatusBadge } from "@/components/orders/order-status";
import { PaymentActions } from "@/components/orders/payment-actions";
import { Button } from "@/components/ui/button";
import { requireBusinessContext } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrder } from "@/services/orders/orders.service";
import { canCollectPayments } from "@/services/payments/payments.service";

export const metadata: Metadata = { title: "Order" };

const ACTION_LABEL: Record<string, string> = {
  "order.created": "Order placed",
  "order.cancelled": "Order cancelled",
};

const dt = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const ctx = await requireBusinessContext();
  if (!ctx.can("orders.view")) redirect("/dashboard");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const data = await getOrder(await createClient(), ctx.business.id, id);
  if (!data) notFound();
  const { order, items, payments, history } = data;
  const delivery = (order.delivery_address ?? {}) as { address?: string; zone?: string | null; eta?: string | null };
  const canManage = ctx.can("orders.manage");
  const paystackConnected = await canCollectPayments(createAdminClient(), ctx.business.id);
  const successPayment = payments.find((p) => p.status === "success");
  const m = (minor: number) => formatMoney(minor, order.currency);

  return (
    <>
      <Link href="/orders" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Orders
      </Link>
      <PageHeader
        title={`Order #${order.order_number}`}
        description={`Placed ${dt(order.created_at)}${order.ai_assisted ? " by your AI assistant" : ""}`}
        actions={
          <>
            <OrderStatusBadge status={order.status} />
            {canManage && <OrderActions orderId={order.id} orderNumber={order.order_number} status={order.status} paid={Boolean(order.paid_at)} />}
          </>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <div className="grid gap-6">
          <section className="rounded-xl border bg-card">
            <h2 className="border-b px-6 py-4 font-semibold">Items</h2>
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {items.map((i) => (
                  <tr key={i.id}>
                    <td className="px-6 py-3">
                      <div className="font-medium">{i.name}</div>
                      {i.variant_label && <div className="text-xs text-muted-foreground">{i.variant_label}</div>}
                    </td>
                    <td className="tabular px-3 py-3 text-right text-muted-foreground">
                      {i.quantity} × {m(i.unit_price_minor)}
                    </td>
                    <td className="tabular px-6 py-3 text-right">{m(i.total_minor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="grid gap-1.5 border-t px-6 py-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular">{m(order.subtotal_minor)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Delivery{delivery.zone ? ` — ${delivery.zone}` : ""}</dt>
                <dd className="tabular">{m(order.delivery_fee_minor)}</dd>
              </div>
              {order.discount_minor > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Discount</dt>
                  <dd className="tabular">−{m(order.discount_minor)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular">{m(order.total_minor)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border bg-card">
            <h2 className="border-b px-6 py-4 font-semibold">Payment</h2>
            <div className="pt-4">
              <PaymentActions
                orderId={order.id}
                status={order.status}
                paystackConnected={paystackConnected}
                canManage={canManage}
                canRefund={canManage && Boolean(successPayment) && order.status !== "refunded" && (ctx.role === "owner" || ctx.role === "admin")}
                refundRequested={Boolean(successPayment?.refund_requested_at)}
              />
            </div>
            {payments.length === 0 ? (
              <p className="px-6 py-4 text-sm text-muted-foreground">
                {order.paid_at ? `Paid ${dt(order.paid_at)}.` : "No payment yet. This order is marked Paid only when the payment provider confirms it."}
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between px-6 py-3">
                    <span>
                      <span className="capitalize">{p.status}</span> <span className="text-xs text-muted-foreground">· {p.reference}</span>
                    </span>
                    <span className="tabular">{formatMoney(p.amount_minor, p.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border bg-card">
            <h2 className="border-b px-6 py-4 font-semibold">History</h2>
            <ol className="grid gap-2 px-6 py-4 text-sm">
              {history.map((h, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  <span>
                    {ACTION_LABEL[h.action] ?? h.action}
                    {h.actor_type === "ai" && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                        <Bot className="size-3" /> AI
                      </span>
                    )}
                    {typeof (h.metadata as { reason?: string })?.reason === "string" && <span className="text-muted-foreground"> — {(h.metadata as { reason: string }).reason}</span>}
                    <span className="block text-xs text-muted-foreground">{dt(h.created_at)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="grid gap-6">
          <section className="rounded-xl border bg-card p-5">
            <h2 className="mb-3 font-semibold">Customer</h2>
            <p className="font-medium">{order.customer_name}</p>
            <p className="text-sm text-muted-foreground">{order.customer_phone}</p>
            <h3 className="mt-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">Deliver to</h3>
            <p className="mt-1 text-sm whitespace-pre-wrap">{delivery.address ?? "—"}</p>
            {delivery.eta && <p className="mt-1 text-xs text-muted-foreground">Estimated delivery: {delivery.eta}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {order.conversation_id && ctx.can("conversations.view") && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/conversations/${order.conversation_id}`}>
                    <MessagesSquare /> Conversation
                  </Link>
                </Button>
              )}
              {ctx.can("customers.view") && (
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/customers/${order.customer_id}`}>Customer profile</Link>
                </Button>
              )}
            </div>
          </section>
          <section className="rounded-xl border bg-card p-5">
            <h2 className="mb-3 font-semibold">Notes</h2>
            <OrderNotes key={order.notes ?? ""} orderId={order.id} notes={order.notes} canEdit={canManage} />
          </section>
        </div>
      </div>
    </>
  );
}
