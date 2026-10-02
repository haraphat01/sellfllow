import "server-only";

import { logger } from "@/lib/observability/logger";
import { formatMoney } from "@/lib/money";
import type { DbClient } from "@/lib/supabase/types";
import { isWithinServiceWindow, sendConversationText } from "@/services/whatsapp/outbound.service";

/**
 * Tells the customer on WhatsApp that their (verified) payment was received.
 * Idempotent: safe to call again for the same order.
 */
export async function notifyPaymentReceived(admin: DbClient, p: { businessId: string; orderId: string }) {
  const { data: order } = await admin
    .from("orders")
    .select("order_number, total_minor, currency, status, conversation_id, conversations(last_customer_message_at, status)")
    .eq("business_id", p.businessId)
    .eq("id", p.orderId)
    .single();
  if (!order || order.status !== "paid") return { skipped: "order not paid" };

  const text = `✅ Payment received for order #${order.order_number} (${formatMoney(order.total_minor, order.currency)}). Thank you! We'll let you know when it's on its way.`;
  const conv = order.conversations as unknown as { last_customer_message_at: string | null; status: string } | null;
  if (!order.conversation_id || !conv || !isWithinServiceWindow(conv.last_customer_message_at)) {
    await admin.from("notifications").insert({
      business_id: p.businessId,
      type: "payment.received",
      title: `Order #${order.order_number} paid`,
      body: "The customer couldn't be messaged automatically (outside WhatsApp's 24-hour window).",
      data: { order_id: p.orderId },
    });
    return { notified: "team" };
  }
  // Don't send twice (retries, webhook + manual check).
  const { data: already } = await admin
    .from("messages")
    .select("id")
    .eq("conversation_id", order.conversation_id)
    .eq("sender", "system")
    .like("body", `✅ Payment received for order #${order.order_number} %`)
    .limit(1);
  if (already?.length) return { notified: "already" };

  await sendConversationText(admin, { businessId: p.businessId, conversationId: order.conversation_id, body: text, sender: "system" });
  await admin.from("notifications").insert({
    business_id: p.businessId,
    type: "payment.received",
    title: `Order #${order.order_number} paid`,
    body: formatMoney(order.total_minor, order.currency),
    data: { order_id: p.orderId },
  });
  logger.info("payment.customer_notified", { business_id: p.businessId, order_id: p.orderId });
  return { notified: "customer" };
}

/** A verified payment arrived for an order that was already cancelled/expired: the team must decide. */
export async function flagUnpayableOrder(admin: DbClient, p: { businessId: string; orderId: string; orderNumber: number }) {
  const { data: order } = await admin.from("orders").select("conversation_id").eq("business_id", p.businessId).eq("id", p.orderId).single();
  if (order?.conversation_id) await admin.from("conversations").update({ needs_attention: true }).eq("id", order.conversation_id);
  await admin.from("notifications").insert({
    business_id: p.businessId,
    type: "payment.unpayable_order",
    title: `Payment received for cancelled order #${p.orderNumber}`,
    body: "Fulfil it (check stock) or refund the customer from the order page.",
    data: { order_id: p.orderId },
  });
  return { flagged: true };
}
