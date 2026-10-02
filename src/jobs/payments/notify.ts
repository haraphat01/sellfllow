import { EVENTS, inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/observability/logger";
import { formatMoney } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWithinServiceWindow, sendConversationText } from "@/services/whatsapp/outbound.service";

const UUID = /^[0-9a-f-]{36}$/;

/** Tells the customer on WhatsApp that their payment was received (verified). */
export const paymentConfirmationJob = inngest.createFunction(
  { id: "payment-confirmation", triggers: [{ event: EVENTS.paymentSucceeded }], retries: 4 },
  async ({ event, step }) => {
    const { businessId, orderId } = event.data as { businessId?: string; orderId?: string };
    if (!UUID.test(businessId ?? "") || !UUID.test(orderId ?? "")) return { skipped: "invalid event" };

    return step.run("notify-customer", async () => {
      const admin = createAdminClient();
      const { data: order } = await admin
        .from("orders")
        .select("order_number, total_minor, currency, status, conversation_id, conversations(last_customer_message_at, status)")
        .eq("business_id", businessId!)
        .eq("id", orderId!)
        .single();
      if (!order || order.status !== "paid") return { skipped: "order not paid" };

      const text = `✅ Payment received for order #${order.order_number} (${formatMoney(order.total_minor, order.currency)}). Thank you! We'll let you know when it's on its way.`;
      const conv = order.conversations as unknown as { last_customer_message_at: string | null; status: string } | null;
      if (!order.conversation_id || !conv || !isWithinServiceWindow(conv.last_customer_message_at)) {
        await admin.from("notifications").insert({
          business_id: businessId!,
          type: "payment.received",
          title: `Order #${order.order_number} paid`,
          body: "The customer couldn't be messaged automatically (outside WhatsApp's 24-hour window).",
          data: { order_id: orderId },
        });
        return { notified: "team" };
      }
      // Idempotent across retries: don't send twice.
      const { data: already } = await admin
        .from("messages")
        .select("id")
        .eq("conversation_id", order.conversation_id)
        .eq("sender", "system")
        .like("body", `✅ Payment received for order #${order.order_number} %`)
        .limit(1);
      if (already?.length) return { notified: "already" };

      await sendConversationText(admin, { businessId: businessId!, conversationId: order.conversation_id, body: text, sender: "system" });
      await admin.from("notifications").insert({
        business_id: businessId!,
        type: "payment.received",
        title: `Order #${order.order_number} paid`,
        body: formatMoney(order.total_minor, order.currency),
        data: { order_id: orderId },
      });
      logger.info("payment.customer_notified", { business_id: businessId, order_id: orderId });
      return { notified: "customer" };
    });
  },
);

/** A verified payment arrived for an order that was already cancelled/expired: the team must decide. */
export const unpayableOrderJob = inngest.createFunction(
  { id: "payment-unpayable-order", triggers: [{ event: EVENTS.paymentForUnpayableOrder }] },
  async ({ event, step }) => {
    const { businessId, orderId, orderNumber } = event.data as { businessId?: string; orderId?: string; orderNumber?: number };
    if (!UUID.test(businessId ?? "") || !UUID.test(orderId ?? "")) return { skipped: "invalid event" };
    return step.run("flag", async () => {
      const admin = createAdminClient();
      const { data: order } = await admin.from("orders").select("conversation_id").eq("id", orderId!).single();
      if (order?.conversation_id) await admin.from("conversations").update({ needs_attention: true }).eq("id", order.conversation_id);
      await admin.from("notifications").insert({
        business_id: businessId!,
        type: "payment.unpayable_order",
        title: `Payment received for cancelled order #${orderNumber}`,
        body: "Fulfil it (check stock) or refund the customer from the order page.",
        data: { order_id: orderId },
      });
      return { flagged: true };
    });
  },
);
