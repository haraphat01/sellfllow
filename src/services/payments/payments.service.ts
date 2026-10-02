import "server-only";

import { randomBytes } from "node:crypto";

import { serverEnv } from "@/lib/env/server";
import { publicEnv } from "@/lib/env/public";
import { logger } from "@/lib/observability/logger";
import { paystackClient, PaystackError, type PaystackClient, type PaystackTransaction } from "@/lib/paystack/client";
import { verifyPaystackSignature } from "@/lib/paystack/signature";
import { decryptSecret } from "@/lib/security/crypto";
import type { DbClient } from "@/lib/supabase/types";
import type { Json } from "@/db/types/database";
import { handleBillingWebhook } from "@/services/billing/billing.service";

import { platformFeeMinor } from "./payouts.core";
import { getCommission } from "./payouts.service";

export class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentError";
  }
}

// ---------------------------------------------------------------------------
// How payments are collected: every business is paid to its bank account,
// as a Paystack subaccount of SellFlow's platform account (Paystack settles
// straight to the merchant's bank; SellFlow never holds the money).
//
// Legacy: before bank payouts, a business could connect its own Paystack key
// (`collection_mode = 'merchant_key'`). New links never use it, but payments
// made that way still verify, refund and receive webhooks with that key.
// ---------------------------------------------------------------------------
const LEGACY_SECRET_LABEL = "secret";

async function legacyMerchantKey(admin: DbClient, businessId: string): Promise<string | null> {
  const { data } = await admin.from("business_credentials").select("ciphertext").eq("business_id", businessId).eq("provider", "paystack").eq("label", LEGACY_SECRET_LABEL).maybeSingle();
  return data ? decryptSecret(data.ciphertext, businessId) : null;
}

type Collection = { client: PaystackClient; subaccountCode: string };

function platformKey() {
  return serverEnv().PAYSTACK_SECRET_KEY ?? null;
}

async function collectionFor(admin: DbClient, businessId: string): Promise<Collection | null> {
  const pk = platformKey();
  if (!pk) return null;
  const { data: payout } = await admin.from("payout_accounts").select("subaccount_code").eq("business_id", businessId).eq("status", "active").maybeSingle();
  if (!payout) return null;
  return { client: paystackClient(pk), subaccountCode: payout.subaccount_code };
}

/** True when payment links can be created: an active bank payout account (and the platform key configured). */
export async function canCollectPayments(admin: DbClient, businessId: string) {
  if (!platformKey()) return false;
  const { count } = await admin.from("payout_accounts").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "active");
  return (count ?? 0) > 0;
}

/** The key that created a payment is the one that verifies, refunds and signs its webhooks. */
async function keyForPayment(admin: DbClient, payment: { business_id: string; collection_mode: string }): Promise<string | null> {
  return payment.collection_mode === "platform_subaccount" ? platformKey() : legacyMerchantKey(admin, payment.business_id);
}

async function clientForPayment(admin: DbClient, payment: { business_id: string; collection_mode: string }): Promise<PaystackClient> {
  const key = await keyForPayment(admin, payment);
  if (!key) throw new PaymentError(payment.collection_mode === "platform_subaccount" ? "Bank payouts aren't configured on this installation." : "The Paystack key this payment was made with is no longer connected.");
  return paystackClient(key);
}

// ---------------------------------------------------------------------------
// Payment links
// ---------------------------------------------------------------------------
const LINK_REUSE_MS = 24 * 60 * 60 * 1000;

/**
 * Returns a Paystack checkout link for an order awaiting payment. Reuses a
 * recent open link for the same amount instead of creating duplicates.
 */
export async function createPaymentLink(admin: DbClient, p: { businessId: string; orderId: string }) {
  const { data: order } = await admin
    .from("orders")
    .select("id, order_number, status, total_minor, currency, customer_id, customers!inner(email, wa_id)")
    .eq("business_id", p.businessId)
    .eq("id", p.orderId)
    .maybeSingle();
  if (!order) throw new PaymentError("Order not found.");
  if (order.status !== "pending_payment") throw new PaymentError(`Order #${order.order_number} isn't awaiting payment (${order.status.replaceAll("_", " ")}).`);

  const { data: existing } = await admin
    .from("payments")
    .select("id, reference, authorization_url, amount_minor, currency, created_at")
    .eq("business_id", p.businessId)
    .eq("order_id", order.id)
    .in("status", ["initialized", "pending"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.authorization_url && existing.amount_minor === order.total_minor && Date.now() - new Date(existing.created_at).getTime() < LINK_REUSE_MS) {
    return { url: existing.authorization_url, reference: existing.reference, amountMinor: existing.amount_minor, currency: existing.currency, orderNumber: order.order_number, reused: true };
  }

  const collection = await collectionFor(admin, p.businessId);
  if (!collection) throw new PaymentError("This business can't take online payments yet — add a payout bank account in Settings → Payments.");
  const fee = platformFeeMinor(order.total_minor, await getCommission(admin));
  const reference = `sf-${order.order_number}-${randomBytes(5).toString("hex")}`;
  const { data: payment, error } = await admin
    .from("payments")
    .insert({
      business_id: p.businessId,
      order_id: order.id,
      provider: "paystack",
      reference,
      amount_minor: order.total_minor,
      currency: order.currency,
      status: "initialized",
      collection_mode: "platform_subaccount",
      subaccount_code: collection.subaccountCode,
      platform_fee_minor: fee,
    })
    .select("id")
    .single();
  if (error) throw error;

  const customer = order.customers as unknown as { email: string | null; wa_id: string };
  try {
    const init = await collection.client.initialize({
      email: customer.email ?? `${customer.wa_id}@${serverEnv().PAYSTACK_PLACEHOLDER_EMAIL_DOMAIN}`,
      amountMinor: order.total_minor,
      currency: order.currency,
      reference,
      callbackUrl: `${publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/pay/complete`,
      metadata: { source: "sellflow", business_id: p.businessId, order_id: order.id, order_number: order.order_number, payment_id: payment.id },
      // Paystack fees come out of the merchant's share, so SellFlow's fee is exactly what's configured.
      split: { subaccount: collection.subaccountCode, transactionChargeMinor: fee, bearer: "subaccount" },
    });
    await admin.from("payments").update({ authorization_url: init.authorization_url, access_code: init.access_code }).eq("id", payment.id);
    return { url: init.authorization_url, reference, amountMinor: order.total_minor, currency: order.currency, orderNumber: order.order_number, reused: false };
  } catch (err) {
    await admin.rpc("mark_payment_failed", { p_business_id: p.businessId, p_payment_id: payment.id, p_status: "failed", p_reason: err instanceof Error ? err.message : "initialize failed" });
    throw err instanceof PaystackError ? new PaymentError(`Paystack couldn't create the payment link: ${err.message}`) : err;
  }
}

// ---------------------------------------------------------------------------
// Confirmation (server-side verify — the only way anything becomes paid)
// ---------------------------------------------------------------------------
export type ConfirmOutcome =
  | { outcome: "paid" | "already_paid"; orderId: string; orderNumber?: number; conversationId?: string | null }
  | { outcome: "order_not_payable"; orderId: string; orderNumber: number; orderStatus: string }
  | { outcome: "not_paid"; status: PaystackTransaction["status"] };

export async function confirmPayment(admin: DbClient, p: { businessId: string; paymentId: string }): Promise<ConfirmOutcome> {
  const { data: payment } = await admin
    .from("payments")
    .select("id, reference, status, order_id, business_id, collection_mode, subaccount_code")
    .eq("business_id", p.businessId)
    .eq("id", p.paymentId)
    .single();
  if (!payment) throw new PaymentError("Payment not found.");
  if (payment.status === "success") return { outcome: "already_paid", orderId: payment.order_id };
  // Never confirm a bank transfer through Paystack (or anything automatic): a person must.
  if (payment.collection_mode === "bank_transfer") throw new PaymentError("Bank transfers are confirmed by the team on the order page.");

  const tx = await (await clientForPayment(admin, payment)).verify(payment.reference);
  if (tx.reference !== payment.reference) throw new PaymentError("Paystack returned a different transaction.");
  // A split payment must have been settled to this business's own subaccount.
  if (payment.collection_mode === "platform_subaccount" && tx.subaccount?.subaccount_code && tx.subaccount.subaccount_code !== payment.subaccount_code) {
    logger.error("payment.subaccount_mismatch", new Error("subaccount mismatch"), { business_id: p.businessId, payment_id: payment.id });
    throw new PaymentError("Paystack reported a different payout account for this payment.");
  }

  if (tx.status === "success") {
    const { data, error } = await admin.rpc("mark_payment_succeeded", {
      p_business_id: p.businessId,
      p_payment_id: payment.id,
      p_amount_minor: tx.amount,
      p_currency: tx.currency,
      p_paid_at: tx.paid_at ?? new Date().toISOString(),
      p_channel: tx.channel ?? "unknown",
      p_provider_transaction_id: String(tx.id),
      p_provider_response: { status: tx.status, gateway_response: tx.gateway_response, channel: tx.channel, paid_at: tx.paid_at } as Json,
    });
    if (error) {
      logger.error("payment.mark_succeeded_failed", error, { business_id: p.businessId, payment_id: payment.id });
      throw error.code === "22023" ? new PaymentError(error.message) : error;
    }
    const r = data as { outcome: string; order_id: string; order_number?: number; conversation_id?: string | null; order_status?: string };
    if (r.outcome === "order_not_payable") return { outcome: "order_not_payable", orderId: r.order_id, orderNumber: r.order_number ?? 0, orderStatus: r.order_status ?? "" };
    return { outcome: r.outcome as "paid" | "already_paid", orderId: r.order_id, orderNumber: r.order_number, conversationId: r.conversation_id };
  }
  if (tx.status === "failed") {
    await admin.rpc("mark_payment_failed", { p_business_id: p.businessId, p_payment_id: payment.id, p_status: "failed", p_reason: tx.gateway_response ?? "failed" });
  }
  // "abandoned"/"ongoing" can still complete later — leave the payment open.
  return { outcome: "not_paid", status: tx.status };
}

/** Confirms the latest open Paystack payment of an order with Paystack (dashboard and AI). Bank transfers are confirmed by a person only. */
export async function refreshOrderPayment(admin: DbClient, p: { businessId: string; orderId: string }) {
  const { data: pay } = await admin
    .from("payments")
    .select("id")
    .eq("business_id", p.businessId)
    .eq("order_id", p.orderId)
    .neq("collection_mode", "bank_transfer")
    .in("status", ["initialized", "pending", "success"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!pay) return null;
  return confirmPayment(admin, { businessId: p.businessId, paymentId: pay.id });
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------
export type WebhookResult = { status: 200 | 401 | 500; handled: string };

type PaystackEvent = { event?: string; data?: { id?: number | string; reference?: string; transaction_reference?: string; status?: string; amount?: number; transaction?: { reference?: string } } };

/**
 * Paystack webhook. The body is untrusted until its signature verifies with
 * the secret key of the business that owns the referenced payment. Even then,
 * a charge is only accepted after a server-side verify call (confirmPayment).
 */
export async function handlePaystackWebhook(
  admin: DbClient,
  p: { rawBody: string; signature: string | null; requestId: string },
): Promise<WebhookResult & { paid?: { businessId: string; orderId: string }; unpayable?: { businessId: string; orderId: string; orderNumber: number } }> {
  const log = logger.child({ request_id: p.requestId, route: "webhooks.paystack" });
  let evt: PaystackEvent;
  try {
    evt = JSON.parse(p.rawBody);
  } catch {
    return { status: 401, handled: "invalid json" };
  }
  const eventName = typeof evt.event === "string" ? evt.event.slice(0, 64) : "";
  const reference = (evt.data?.reference ?? evt.data?.transaction_reference ?? evt.data?.transaction?.reference ?? "").toString().slice(0, 200);
  if (!eventName || !reference) return { status: 200, handled: "ignored: no reference" };

  // SellFlow's own account sends subscription and split-payment events to one
  // URL, so either webhook endpoint accepts both kinds.
  if (reference.startsWith("sfb-")) {
    const res = await handleBillingWebhook(admin, p);
    return { status: res.status === 200 ? 200 : res.status === 401 ? 401 : 500, handled: `billing: ${res.handled}` };
  }

  const { data: payment } = await admin.from("payments").select("id, business_id, collection_mode").eq("reference", reference).maybeSingle();
  if (!payment) {
    // Not a SellFlow transaction (merchants may use Paystack for other things). Reveal nothing.
    log.info("paystack.webhook.unknown_reference", { event: eventName });
    return { status: 200, handled: "ignored: unknown reference" };
  }
  const key = await keyForPayment(admin, payment);
  if (!key || !verifyPaystackSignature(p.rawBody, p.signature, key)) {
    log.warn("paystack.webhook.bad_signature", { business_id: payment.business_id, event: eventName });
    return { status: 401, handled: "invalid signature" };
  }

  // Idempotency: one row per (event, transaction id / reference).
  const eventKey = `${eventName}:${evt.data?.id ?? reference}`;
  await admin
    .from("payment_events")
    .upsert(
      { provider: "paystack", event_key: eventKey, event_type: eventName, business_id: payment.business_id, payment_id: payment.id, payload: JSON.parse(p.rawBody) as Json, request_id: p.requestId },
      { onConflict: "provider,event_key", ignoreDuplicates: true },
    );
  const { data: claimed } = await admin
    .from("payment_events")
    .update({ status: "processing" })
    .eq("provider", "paystack")
    .eq("event_key", eventKey)
    .in("status", ["received", "failed"])
    .select("id")
    .maybeSingle();
  if (!claimed) return { status: 200, handled: "duplicate" };

  const finish = (status: "processed" | "failed" | "ignored", error?: string) =>
    admin.from("payment_events").update({ status, error: error ?? null, processed_at: new Date().toISOString() }).eq("id", claimed.id);

  try {
    if (eventName === "charge.success") {
      const r = await confirmPayment(admin, { businessId: payment.business_id, paymentId: payment.id });
      await finish("processed");
      log.info("paystack.charge.confirmed", { business_id: payment.business_id, payment_id: payment.id, outcome: r.outcome });
      if (r.outcome === "paid") return { status: 200, handled: "paid", paid: { businessId: payment.business_id, orderId: r.orderId } };
      if (r.outcome === "order_not_payable") return { status: 200, handled: "unpayable", unpayable: { businessId: payment.business_id, orderId: r.orderId, orderNumber: r.orderNumber } };
      return { status: 200, handled: r.outcome };
    }
    if (eventName === "refund.processed") {
      await admin.rpc("mark_payment_refunded", { p_business_id: payment.business_id, p_payment_id: payment.id, p_amount_minor: Number(evt.data?.amount ?? 0) || (null as unknown as number) });
      await finish("processed");
      return { status: 200, handled: "refunded" };
    }
    if (eventName === "refund.failed") {
      await admin.from("notifications").insert({ business_id: payment.business_id, type: "payment.refund_failed", title: "A refund failed", body: `Paystack couldn't process the refund for ${reference}.`, data: { payment_id: payment.id } });
      await finish("processed");
      return { status: 200, handled: "refund failed noted" };
    }
    await finish("ignored");
    return { status: 200, handled: `ignored: ${eventName}` };
  } catch (err) {
    await finish("failed", err instanceof Error ? err.message : String(err));
    log.error("paystack.webhook.failed", err, { business_id: payment.business_id, event: eventName });
    return { status: 500, handled: "error" };
  }
}

// ---------------------------------------------------------------------------
// Refunds (merchant-initiated; completion arrives via refund.processed)
// ---------------------------------------------------------------------------
export async function requestRefund(admin: DbClient, p: { businessId: string; orderId: string; userId: string }) {
  const { data: pay } = await admin
    .from("payments")
    .select("id, reference, status, refund_requested_at, business_id, collection_mode")
    .eq("business_id", p.businessId)
    .eq("order_id", p.orderId)
    .eq("status", "success")
    .neq("collection_mode", "bank_transfer")
    .maybeSingle();
  if (!pay) throw new PaymentError("This order has no Paystack payment to refund. Bank transfers are refunded from your own bank account.");
  if (pay.refund_requested_at) throw new PaymentError("A refund has already been requested for this order.");
  try {
    await (await clientForPayment(admin, pay)).refund(pay.reference);
  } catch (err) {
    throw err instanceof PaystackError ? new PaymentError(`Paystack couldn't start the refund: ${err.message}`) : err;
  }
  await admin.from("payments").update({ refund_requested_at: new Date().toISOString() }).eq("id", pay.id);
  await admin.from("audit_logs").insert({ business_id: p.businessId, actor_user_id: p.userId, action: "order.refund_requested", entity_type: "order", entity_id: p.orderId, metadata: { reference: pay.reference } });
}
