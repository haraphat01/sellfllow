import "server-only";

import { logger } from "@/lib/observability/logger";
import { formatMoney } from "@/lib/money";
import type { DbClient } from "@/lib/supabase/types";
import { getPlan, isOverLimit } from "@/services/billing/limits";
import { getBankTransferSettings } from "@/services/payments/bank-transfer.service";
import { isWithinServiceWindow, OutboundMessageError, sendConversationText, sendTemplateToNumber } from "@/services/whatsapp/outbound.service";

import { nextSendTime, renderFollowUp, type FollowUpContent } from "./follow-ups.core";

/**
 * Abandoned-lead recovery. The database decides *whether* a conversation may
 * be followed up (`follow_up_stop_reason`, `schedule_follow_ups`); this service
 * decides *what* to send and *when*, then sends at most once per follow-up.
 */

export type FollowUpResult =
  | { outcome: "sent"; channel: "text" | "template"; messageId: string }
  | { outcome: "cancelled" | "skipped"; reason: string }
  | { outcome: "rescheduled"; reason: "recent_activity" | "outside_sending_hours"; at: string }
  | { outcome: "failed"; reason: string }
  | { outcome: "noop"; reason: string };

/** Runs the scheduler in the database: cancels stopped follow-ups and schedules new ones. */
export async function scheduleFollowUps(admin: DbClient) {
  const { data, error } = await admin.rpc("schedule_follow_ups", { p_limit: 500 });
  if (error) throw error;
  return data as { cancelled: number; scheduled: number };
}

/** Follow-ups that are due now (the sender re-checks everything). */
export async function dueFollowUps(admin: DbClient, now = new Date(), limit = 500) {
  const { data, error } = await admin
    .from("follow_ups")
    .select("id, business_id")
    .eq("status", "scheduled")
    .lte("scheduled_for", now.toISOString())
    .order("scheduled_for")
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function processFollowUp(admin: DbClient, followUpId: string, now = new Date()): Promise<FollowUpResult> {
  const { data: fu } = await admin
    .from("follow_ups")
    .select("id, business_id, conversation_id, customer_id, status, scheduled_for, sequence_number")
    .eq("id", followUpId)
    .maybeSingle();
  if (!fu) return { outcome: "noop", reason: "not found" };
  if (fu.status !== "scheduled") return { outcome: "noop", reason: `already ${fu.status}` };
  const log = logger.child({ business_id: fu.business_id, conversation_id: fu.conversation_id, follow_up_id: fu.id });

  const end = async (status: "cancelled" | "skipped", reason: string): Promise<FollowUpResult> => {
    await admin.from("follow_ups").update({ status, cancel_reason: reason }).eq("id", fu.id).eq("status", "scheduled");
    log.info(`follow_up.${status}`, { reason });
    return { outcome: status, reason };
  };
  const reschedule = async (at: Date, reason: "recent_activity" | "outside_sending_hours"): Promise<FollowUpResult> => {
    await admin.from("follow_ups").update({ scheduled_for: at.toISOString() }).eq("id", fu.id).eq("status", "scheduled");
    return { outcome: "rescheduled", reason, at: at.toISOString() };
  };

  const { data: stop, error: stopError } = await admin.rpc("follow_up_stop_reason", { p_conversation_id: fu.conversation_id });
  if (stopError) throw stopError;
  if (stop) return end("cancelled", stop);

  const [{ data: conv }, { data: settings }, { data: business }] = await Promise.all([
    admin
      .from("conversations")
      .select("id, whatsapp_account_id, last_message_at, last_customer_message_at, purchase_intent_at, state, customers!inner(wa_id, name, profile_name)")
      .eq("business_id", fu.business_id)
      .eq("id", fu.conversation_id)
      .single(),
    admin
      .from("ai_settings")
      .select("follow_up_delay_minutes, follow_up_message, follow_up_respect_hours, follow_up_window_start, follow_up_window_end, follow_up_template_name, follow_up_template_language")
      .eq("business_id", fu.business_id)
      .single(),
    admin.from("businesses").select("timezone, currency").eq("id", fu.business_id).single(),
  ]);
  if (!conv || !settings || !business) return end("cancelled", "not_found");

  // Someone spoke since this was scheduled: wait for a full quiet period again.
  const lastActivity = Math.max(Date.parse(conv.last_message_at ?? "") || 0, Date.parse(conv.purchase_intent_at ?? "") || 0);
  const quietUntil = new Date(lastActivity + settings.follow_up_delay_minutes * 60_000);
  if (quietUntil.getTime() > now.getTime() + 30_000) return reschedule(quietUntil, "recent_activity");

  if (settings.follow_up_respect_hours) {
    const at = nextSendTime(now, business.timezone, settings.follow_up_window_start, settings.follow_up_window_end);
    if (at.getTime() > now.getTime()) return reschedule(at, "outside_sending_hours");
  }

  const content = await loadContent(admin, fu.business_id, fu.conversation_id, conv.state as Record<string, unknown>, business.currency);
  if (content.kind === "unavailable") return end("skipped", "out_of_stock");
  if (content.kind === "awaiting_confirmation") return end("skipped", "payment_claimed");

  const customer = conv.customers as unknown as { wa_id: string; name: string | null; profile_name: string | null };
  const firstName = (customer.name ?? customer.profile_name ?? "").trim().split(/\s+/)[0] ?? "";
  const text = renderFollowUp({ ...content, customerFirstName: firstName }, settings.follow_up_message);

  const inWindow = isWithinServiceWindow(conv.last_customer_message_at, now);
  const channel = inWindow ? "text" : settings.follow_up_template_name ? "template" : null;
  if (!channel) return end("skipped", "window_closed");
  if (!conv.whatsapp_account_id) return end("cancelled", "no_whatsapp_number");

  const plan = await getPlan(admin, fu.business_id);
  if (!plan || (await isOverLimit(admin, fu.business_id, plan, "messages", now))) return end("skipped", "usage_limit");

  const orderId = content.kind === "pending_order" ? content.orderId : null;
  const { data: claimed, error: claimError } = await admin.rpc("claim_follow_up", {
    p_follow_up_id: fu.id,
    p_message: channel === "text" ? text : `[template: ${settings.follow_up_template_name}]`,
    p_channel: channel,
    p_order_id: orderId as string,
  });
  if (claimError) throw claimError;
  if (!claimed) return { outcome: "noop", reason: "claimed elsewhere" };

  // From here on the follow-up is "sent" (at most once): a failure is recorded, never retried.
  try {
    const sent =
      channel === "text"
        ? await sendConversationText(admin, { businessId: fu.business_id, conversationId: fu.conversation_id, body: text, sender: "automation" })
        : await sendTemplateToNumber(admin, {
            businessId: fu.business_id,
            accountId: conv.whatsapp_account_id,
            toWaId: customer.wa_id,
            template: { name: settings.follow_up_template_name!, language: settings.follow_up_template_language },
            sender: "automation",
          });
    await admin.from("follow_ups").update({ message_id: sent.messageId }).eq("id", fu.id);
    await admin.from("conversation_events").insert({
      business_id: fu.business_id,
      conversation_id: fu.conversation_id,
      type: "follow_up_sent",
      actor_type: "system",
      data: { follow_up_id: fu.id, sequence_number: fu.sequence_number, channel, order_id: orderId },
    });
    log.info("follow_up.sent", { channel, message_id: sent.messageId, sequence_number: fu.sequence_number });
    return { outcome: "sent", channel, messageId: sent.messageId };
  } catch (err) {
    const reason = err instanceof OutboundMessageError ? err.reason : "send_failed";
    await admin.from("follow_ups").update({ status: "failed", cancel_reason: reason }).eq("id", fu.id);
    log.error("follow_up.send_failed", err, { reason });
    return { outcome: "failed", reason };
  }
}

/**
 * What the follow-up is about, from trusted data only: an unpaid order in this
 * conversation (with its payment link), else the product the AI recorded —
 * which must still be in stock.
 */
async function loadContent(
  admin: DbClient,
  businessId: string,
  conversationId: string,
  state: Record<string, unknown>,
  currency: string,
): Promise<(FollowUpContent & { orderId?: string }) | { kind: "unavailable" } | { kind: "awaiting_confirmation" }> {
  const { data: order } = await admin
    .from("orders")
    .select("id, order_number, total_minor, currency, payments(authorization_url, status, created_at, collection_mode)")
    .eq("business_id", businessId)
    .eq("conversation_id", conversationId)
    .eq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (order) {
    const payments = (order.payments ?? []) as { authorization_url: string | null; status: string; created_at: string; collection_mode: string }[];
    // The customer already says they've paid by transfer: the team is checking — don't nag.
    if (payments.some((p) => p.collection_mode === "bank_transfer" && p.status === "pending")) return { kind: "awaiting_confirmation" };
    const transfer = payments.some((p) => p.collection_mode === "bank_transfer" && p.status === "initialized") ? await getBankTransferSettings(admin, businessId) : null;
    const link = payments
      .filter((p) => p.authorization_url && (p.status === "initialized" || p.status === "pending"))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.authorization_url;
    return {
      kind: "pending_order",
      orderId: order.id,
      orderNumber: order.order_number,
      total: formatMoney(order.total_minor, order.currency ?? currency),
      paymentLink: link ?? null,
      bankDetails: !link && transfer?.enabled ? `${transfer.bank_name} ${transfer.account_number} (${transfer.account_name})` : null,
    };
  }

  const productId = typeof state.product_id === "string" ? state.product_id : null;
  if (!productId) return { kind: "general" };
  const { data: product } = await admin
    .from("products")
    .select("name, status, stock_quantity")
    .eq("business_id", businessId)
    .eq("id", productId)
    .maybeSingle();
  if (!product || product.status !== "active") return { kind: "unavailable" };

  const variantId = typeof state.variant_id === "string" ? state.variant_id : null;
  let stock = product.stock_quantity;
  let label = product.name;
  if (variantId) {
    const { data: variant } = await admin
      .from("product_variants")
      .select("name, stock_quantity")
      .eq("business_id", businessId)
      .eq("id", variantId)
      .maybeSingle();
    if (!variant) return { kind: "unavailable" };
    stock = variant.stock_quantity;
    label = `${product.name} (${variant.name})`;
  }
  if (stock <= 0) return { kind: "unavailable" };
  return { kind: "product", productName: label };
}
