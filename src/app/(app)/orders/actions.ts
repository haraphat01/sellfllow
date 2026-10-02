"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionResult } from "@/lib/actions";
import { authorize } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { dispatchPaymentSucceeded, dispatchUnpayableOrder } from "@/jobs/events";
import { advanceFulfilment, cancelOrder, updateOrderNotes } from "@/services/orders/orders.service";
import { confirmBankTransfer, rejectBankTransfer } from "@/services/payments/bank-transfer.service";
import { createPaymentLink, refreshOrderPayment, requestRefund } from "@/services/payments/payments.service";

const id = z.uuid();

function refresh(orderId: string) {
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
}

export async function advanceOrderAction(orderId: string, to: "processing" | "shipped" | "delivered"): Promise<ActionResult> {
  if (!id.safeParse(orderId).success || !["processing", "shipped", "delivered"].includes(to)) return { ok: false, error: "Invalid request." };
  try {
    const ctx = await authorize("orders.manage");
    await advanceFulfilment(await createClient(), ctx.business.id, orderId, to);
    refresh(orderId);
    return { ok: true, message: `Order marked ${to}` };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "order.advance", order_id: orderId }) };
  }
}

/** Cancels an unpaid order and returns its stock (service function; authorised here). */
export async function cancelOrderAction(orderId: string, reason: string): Promise<ActionResult> {
  const r = z.string().trim().min(3, "Give a short reason").max(200).safeParse(reason);
  if (!id.safeParse(orderId).success) return { ok: false, error: "Invalid request." };
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  try {
    const ctx = await authorize("orders.manage");
    await cancelOrder(createAdminClient(), { businessId: ctx.business.id, orderId, reason: r.data, actorId: ctx.user.id });
    refresh(orderId);
    return { ok: true, message: "Order cancelled and stock returned" };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "order.cancel", order_id: orderId }) };
  }
}

export async function updateOrderNotesAction(orderId: string, notes: string): Promise<ActionResult> {
  if (!id.safeParse(orderId).success || typeof notes !== "string" || notes.length > 2000) return { ok: false, error: "Invalid request." };
  try {
    const ctx = await authorize("orders.manage");
    await updateOrderNotes(await createClient(), ctx.business.id, orderId, notes.trim() || null);
    refresh(orderId);
    return { ok: true, message: "Notes saved" };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "order.notes", order_id: orderId }) };
  }
}

// ---------------------------------------------------------------------------
// Payments (Paystack)
// ---------------------------------------------------------------------------
export async function paymentLinkAction(orderId: string): Promise<{ ok: true; url: string; reused: boolean } | { ok: false; error: string }> {
  if (!id.safeParse(orderId).success) return { ok: false, error: "Invalid request." };
  try {
    const ctx = await authorize("orders.manage");
    const link = await createPaymentLink(createAdminClient(), { businessId: ctx.business.id, orderId });
    refresh(orderId);
    return { ok: true, url: link.url, reused: link.reused };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "order.payment_link", order_id: orderId }) };
  }
}

/** Asks Paystack for the payment's real status (works without webhooks). */
export async function checkPaymentAction(orderId: string): Promise<ActionResult> {
  if (!id.safeParse(orderId).success) return { ok: false, error: "Invalid request." };
  try {
    const ctx = await authorize("orders.view");
    const admin = createAdminClient();
    const r = await refreshOrderPayment(admin, { businessId: ctx.business.id, orderId });
    refresh(orderId);
    if (!r) return { ok: false, error: "No payment link has been created for this order yet." };
    if (r.outcome === "paid") {
      dispatchPaymentSucceeded({ businessId: ctx.business.id, orderId });
      return { ok: true, message: "Paystack confirmed the payment — order marked Paid" };
    }
    if (r.outcome === "order_not_payable") return { ok: true, message: `Payment received, but the order is ${r.orderStatus}. Fulfil or refund it.` };
    if (r.outcome === "not_paid") return { ok: true, message: `Not paid yet (Paystack status: ${r.status})` };
    return { ok: true, message: "Already paid" };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "order.check_payment", order_id: orderId }) };
  }
}

export async function refundOrderAction(orderId: string): Promise<ActionResult> {
  if (!id.safeParse(orderId).success) return { ok: false, error: "Invalid request." };
  try {
    const ctx = await authorize("orders.manage");
    if (ctx.role !== "owner" && ctx.role !== "admin") return { ok: false, error: "Only owners and admins can issue refunds." };
    await requestRefund(createAdminClient(), { businessId: ctx.business.id, orderId, userId: ctx.user.id });
    refresh(orderId);
    return { ok: true, message: "Refund requested — the order updates when Paystack completes it" };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "order.refund", order_id: orderId }) };
  }
}

/**
 * Bank transfer: a person confirms the money arrived in the business's account.
 * This is the ONLY way a bank-transfer order becomes paid.
 */
export async function confirmBankTransferAction(orderId: string): Promise<ActionResult> {
  if (!id.safeParse(orderId).success) return { ok: false, error: "Invalid request." };
  try {
    const ctx = await authorize("orders.manage");
    const res = await confirmBankTransfer(createAdminClient(), { businessId: ctx.business.id, orderId, userId: ctx.user.id });
    refresh(orderId);
    if (res.outcome === "paid") {
      dispatchPaymentSucceeded({ businessId: ctx.business.id, orderId });
      return { ok: true, message: "Payment confirmed — order marked Paid and the customer is notified" };
    }
    if (res.outcome === "order_not_payable") {
      dispatchUnpayableOrder({ businessId: ctx.business.id, orderId, orderNumber: res.order_number ?? 0 });
      return { ok: true, message: "Payment recorded, but this order was already cancelled. Fulfil or refund it." };
    }
    return { ok: true, message: "Already paid" };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "order.bank_transfer.confirm", order_id: orderId }) };
  }
}

/** Bank transfer: the money hasn't arrived — clear the claim and ask the customer to check. */
export async function rejectBankTransferAction(orderId: string, note: string): Promise<ActionResult> {
  if (!id.safeParse(orderId).success) return { ok: false, error: "Invalid request." };
  try {
    const ctx = await authorize("orders.manage");
    const res = await rejectBankTransfer(createAdminClient(), { businessId: ctx.business.id, orderId, userId: ctx.user.id, note: note.trim().slice(0, 300) || null });
    refresh(orderId);
    return { ok: true, message: `Marked as not received. The customer was asked to check their transfer for order #${res.orderNumber}.` };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "order.bank_transfer.reject", order_id: orderId }) };
  }
}
