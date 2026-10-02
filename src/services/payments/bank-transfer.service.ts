import "server-only";

import { randomBytes } from "node:crypto";

import { formatMoney } from "@/lib/money";
import { logger } from "@/lib/observability/logger";
import type { DbClient } from "@/lib/supabase/types";
import { isWithinServiceWindow, sendConversationText } from "@/services/whatsapp/outbound.service";

import { PaymentError } from "./payments.service";

/**
 * Manual bank transfer: the customer pays straight into the business's own
 * account. The AI shares the details and records the customer's claim (with
 * any receipt they send); ONLY a person on the team confirms the money arrived
 * — there is deliberately no automatic path to "paid" here.
 */

export type BankTransferSettings = {
  enabled: boolean;
  bank_name: string;
  account_number: string;
  account_name: string;
  instructions: string | null;
};

export async function getBankTransferSettings(db: DbClient, businessId: string): Promise<BankTransferSettings | null> {
  const { data } = await db.from("bank_transfer_settings").select("enabled, bank_name, account_number, account_name, instructions").eq("business_id", businessId).maybeSingle();
  return data;
}

export async function isBankTransferEnabled(db: DbClient, businessId: string) {
  return Boolean((await getBankTransferSettings(db, businessId))?.enabled);
}

export async function saveBankTransferSettings(
  admin: DbClient,
  p: { businessId: string; userId: string; enabled: boolean; bankName: string; accountNumber: string; accountName: string; instructions: string | null },
) {
  const { error } = await admin.from("bank_transfer_settings").upsert(
    {
      business_id: p.businessId,
      enabled: p.enabled,
      bank_name: p.bankName,
      account_number: p.accountNumber,
      account_name: p.accountName,
      instructions: p.instructions,
      updated_by: p.userId,
    },
    { onConflict: "business_id" },
  );
  if (error) throw error;
  await admin.from("audit_logs").insert({
    business_id: p.businessId,
    actor_user_id: p.userId,
    action: "payments.bank_transfer_settings_updated",
    metadata: { enabled: p.enabled, bank: p.bankName, last4: p.accountNumber.slice(-4), account_name: p.accountName },
  });
}

/** The narration customers should use, so the business can match the transfer. */
export const narrationFor = (orderNumber: number) => `Order ${orderNumber}`;

/**
 * Returns (creating if needed) the bank-transfer payment for an unpaid order,
 * with everything the customer needs to pay.
 */
export async function bankTransferDetails(admin: DbClient, p: { businessId: string; orderId: string }) {
  const settings = await getBankTransferSettings(admin, p.businessId);
  if (!settings?.enabled) throw new PaymentError("Bank transfer isn't set up for this business.");
  const { data: order } = await admin.from("orders").select("id, order_number, status, total_minor, currency").eq("business_id", p.businessId).eq("id", p.orderId).maybeSingle();
  if (!order) throw new PaymentError("Order not found.");
  if (order.status !== "pending_payment") throw new PaymentError(`Order #${order.order_number} isn't awaiting payment (${order.status.replaceAll("_", " ")}).`);

  const { data: existing } = await admin
    .from("payments")
    .select("id, status, claimed_at, amount_minor")
    .eq("business_id", p.businessId)
    .eq("order_id", order.id)
    .eq("collection_mode", "bank_transfer")
    .in("status", ["initialized", "pending"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let payment = existing && existing.amount_minor === order.total_minor ? existing : null;
  if (!payment) {
    const { data, error } = await admin
      .from("payments")
      .insert({
        business_id: p.businessId,
        order_id: order.id,
        provider: "bank_transfer",
        collection_mode: "bank_transfer",
        reference: `bt-${order.order_number}-${randomBytes(4).toString("hex")}`,
        amount_minor: order.total_minor,
        currency: order.currency,
        status: "initialized",
      })
      .select("id, status, claimed_at, amount_minor")
      .single();
    if (error) throw error;
    payment = data;
  }
  return {
    paymentId: payment.id,
    orderId: order.id,
    orderNumber: order.order_number,
    amountMinor: order.total_minor,
    currency: order.currency,
    bankName: settings.bank_name,
    accountNumber: settings.account_number,
    accountName: settings.account_name,
    instructions: settings.instructions,
    narration: narrationFor(order.order_number),
    claimed: payment.status === "pending",
  };
}

/**
 * The customer says they've paid (optionally with a receipt). Records the
 * claim and alerts the team. Does NOT mark anything paid.
 */
export async function recordPaymentClaim(admin: DbClient, p: { businessId: string; orderId: string; conversationId: string | null; proofMessageId: string | null }) {
  const details = await bankTransferDetails(admin, { businessId: p.businessId, orderId: p.orderId });
  const { error } = await admin
    .from("payments")
    .update({ status: "pending", claimed_at: new Date().toISOString(), ...(p.proofMessageId ? { proof_message_id: p.proofMessageId } : {}), rejected_at: null, rejection_note: null })
    .eq("id", details.paymentId)
    .in("status", ["initialized", "pending"]);
  if (error) throw error;

  if (p.conversationId) {
    await admin.from("conversations").update({ needs_attention: true }).eq("business_id", p.businessId).eq("id", p.conversationId);
    await admin.from("conversation_events").insert({
      business_id: p.businessId,
      conversation_id: p.conversationId,
      type: "payment_claimed",
      actor_type: "ai",
      data: { order_id: p.orderId, order_number: details.orderNumber, with_receipt: Boolean(p.proofMessageId) },
    });
  }
  await admin.from("notifications").insert({
    business_id: p.businessId,
    type: "payment.claimed",
    title: `Check payment for order #${details.orderNumber}`,
    body: `The customer says they've paid ${formatMoney(details.amountMinor, details.currency)} by bank transfer${p.proofMessageId ? " and sent a receipt" : ""}. Check your bank, then confirm on the order page.`,
    data: { order_id: p.orderId },
  });
  logger.info("payment.bank_transfer_claimed", { business_id: p.businessId, order_id: p.orderId, with_receipt: Boolean(p.proofMessageId) });
  return details;
}

/** Latest receipt (image or PDF) the customer sent in this conversation since `since`. */
export async function latestReceiptMessage(admin: DbClient, p: { businessId: string; conversationId: string; since: string }) {
  const { data } = await admin
    .from("messages")
    .select("id")
    .eq("business_id", p.businessId)
    .eq("conversation_id", p.conversationId)
    .eq("direction", "inbound")
    .in("type", ["image", "document"])
    .gte("created_at", p.since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/** A person confirms the transfer arrived. Returns the paid result (callers send the WhatsApp confirmation). */
export async function confirmBankTransfer(admin: DbClient, p: { businessId: string; orderId: string; userId: string }) {
  const { data: pay } = await admin
    .from("payments")
    .select("id")
    .eq("business_id", p.businessId)
    .eq("order_id", p.orderId)
    .eq("collection_mode", "bank_transfer")
    .in("status", ["initialized", "pending"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // No bank-transfer payment yet (customer paid without telling the AI): create one, then confirm it.
  const paymentId = pay?.id ?? (await bankTransferDetails(admin, { businessId: p.businessId, orderId: p.orderId })).paymentId;
  const { data, error } = await admin.rpc("confirm_bank_transfer", { p_business_id: p.businessId, p_payment_id: paymentId, p_user_id: p.userId });
  if (error) throw error.code === "P0002" ? new PaymentError("Bank transfer not found for this order.") : error;
  return data as { outcome: "paid" | "already_paid" | "order_not_payable"; order_id: string; order_number?: number };
}

/** A person says the money hasn't arrived: clear the claim and tell the customer politely. */
export async function rejectBankTransfer(admin: DbClient, p: { businessId: string; orderId: string; userId: string; note: string | null }) {
  const { data: pay } = await admin
    .from("payments")
    .select("id, orders!inner(order_number, conversation_id)")
    .eq("business_id", p.businessId)
    .eq("order_id", p.orderId)
    .eq("collection_mode", "bank_transfer")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!pay) throw new PaymentError("There's no payment claim to reject for this order.");
  const { data: ok, error } = await admin.rpc("reject_bank_transfer", { p_business_id: p.businessId, p_payment_id: pay.id, p_user_id: p.userId, p_note: p.note ?? "" });
  if (error) throw error;
  if (!ok) throw new PaymentError("This payment can no longer be rejected.");

  const order = pay.orders as unknown as { order_number: number; conversation_id: string | null };
  if (order.conversation_id) {
    const { data: conv } = await admin.from("conversations").select("last_customer_message_at").eq("id", order.conversation_id).single();
    if (conv && isWithinServiceWindow(conv.last_customer_message_at)) {
      await sendConversationText(admin, {
        businessId: p.businessId,
        conversationId: order.conversation_id,
        body: `We haven't received your transfer for order #${order.order_number} yet. Please check the account details and amount, then send the receipt again, or reply here if you need help.`,
        sender: "staff",
        senderUserId: p.userId,
      }).catch((err) => logger.warn("payment.reject_notice_failed", { business_id: p.businessId, error: err instanceof Error ? err.message : String(err) }));
    }
  }
  return { orderNumber: order.order_number };
}
