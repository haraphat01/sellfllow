import "server-only";

import { logger } from "@/lib/observability/logger";
import type { DbClient } from "@/lib/supabase/types";
import { GraphApiError, templateNeedsNoParameters } from "@/lib/whatsapp/graph";

import { getClientForAccount } from "./accounts.service";
import { ensureOpenConversation, preview, upsertCustomer } from "./conversations.repo";

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export class OutboundMessageError extends Error {
  constructor(
    message: string,
    public reason: "window_closed" | "not_connected" | "opted_out" | "send_failed" | "not_found",
  ) {
    super(message);
    this.name = "OutboundMessageError";
  }
}

export function isWithinServiceWindow(lastCustomerMessageAt: string | null, now = new Date()) {
  return Boolean(lastCustomerMessageAt) && now.getTime() - new Date(lastCustomerMessageAt as string).getTime() < SERVICE_WINDOW_MS;
}

type Sender = { sender: "ai" | "staff" | "system" | "automation"; senderUserId?: string | null; aiRequestId?: string | null };

/**
 * Sends a free-form text reply in an existing conversation. Only allowed
 * inside WhatsApp's 24-hour customer-service window; outside it, callers must
 * use an approved template. The message row is written before calling Meta so
 * every attempt is traceable, then updated with the result.
 */
export async function sendConversationText(
  admin: DbClient,
  params: { businessId: string; conversationId: string; body: string } & Sender,
) {
  const body = params.body.trim().slice(0, 4096);
  if (!body) throw new OutboundMessageError("Message is empty.", "send_failed");

  const { data: conv } = await admin
    .from("conversations")
    .select("id, whatsapp_account_id, last_customer_message_at, customers!inner(wa_id, opted_out_at)")
    .eq("business_id", params.businessId)
    .eq("id", params.conversationId)
    .maybeSingle();
  if (!conv) throw new OutboundMessageError("Conversation not found.", "not_found");
  if (!conv.whatsapp_account_id) throw new OutboundMessageError("This conversation has no WhatsApp number.", "not_connected");
  if (!isWithinServiceWindow(conv.last_customer_message_at)) {
    throw new OutboundMessageError(
      "It's been more than 24 hours since the customer's last message. WhatsApp only allows approved templates now.",
      "window_closed",
    );
  }
  const customer = conv.customers as unknown as { wa_id: string; opted_out_at: string | null };

  return deliver(admin, {
    businessId: params.businessId,
    conversationId: conv.id,
    accountId: conv.whatsapp_account_id,
    to: customer.wa_id,
    type: "text",
    body,
    sender: params,
    send: (wa, phoneNumberId) => wa.sendText(phoneNumberId, customer.wa_id, body),
  });
}

/**
 * Sends an approved template to a phone number (e.g. the connection test,
 * follow-ups outside the 24h window). Creates the customer/conversation so the
 * reply lands in the inbox.
 */
export async function sendTemplateToNumber(
  admin: DbClient,
  params: { businessId: string; accountId: string; toWaId: string; template: { name: string; language: string; components?: unknown[] } } & Sender,
) {
  const customer = await upsertCustomer(admin, { businessId: params.businessId, waId: params.toWaId });
  if (customer.opted_out_at && params.sender !== "staff") throw new OutboundMessageError("This customer opted out of automated messages.", "opted_out");
  const conversation = await ensureOpenConversation(admin, { businessId: params.businessId, customerId: customer.id, whatsappAccountId: params.accountId });

  return deliver(admin, {
    businessId: params.businessId,
    conversationId: conversation.id,
    accountId: params.accountId,
    to: params.toWaId,
    type: "template",
    body: `[template: ${params.template.name}]`,
    content: { template: params.template },
    sender: params,
    send: (wa, phoneNumberId) => wa.sendTemplate(phoneNumberId, params.toWaId, params.template),
  });
}

async function deliver(
  admin: DbClient,
  p: {
    businessId: string;
    conversationId: string;
    accountId: string;
    to: string;
    type: string;
    body: string;
    content?: Record<string, unknown>;
    sender: Sender;
    send: (wa: Awaited<ReturnType<typeof getClientForAccount>>["wa"], phoneNumberId: string) => Promise<{ waMessageId: string }>;
  },
) {
  const log = logger.child({ business_id: p.businessId, conversation_id: p.conversationId, whatsapp_account_id: p.accountId, ai_request_id: p.sender.aiRequestId ?? undefined });

  const { data: message, error } = await admin
    .from("messages")
    .insert({
      business_id: p.businessId,
      conversation_id: p.conversationId,
      direction: "outbound",
      sender: p.sender.sender,
      sender_user_id: p.sender.senderUserId ?? null,
      ai_request_id: p.sender.aiRequestId ?? null,
      type: p.type,
      body: p.body,
      content: (p.content ?? {}) as never,
      status: "queued",
    })
    .select("id")
    .single();
  if (error) throw error;

  const now = new Date().toISOString();
  await admin
    .from("conversations")
    .update({ last_message_at: now, last_message_preview: preview(p.body, p.type) })
    .eq("business_id", p.businessId)
    .eq("id", p.conversationId);

  try {
    const { wa, phoneNumberId } = await getClientForAccount(admin, p.businessId, p.accountId);
    const { waMessageId } = await p.send(wa, phoneNumberId);
    // A fast "sent"/"delivered" webhook may already have arrived; only move forward from queued.
    await admin.from("messages").update({ wa_message_id: waMessageId, status: "sent" }).eq("id", message.id).eq("status", "queued");
    await admin.from("messages").update({ wa_message_id: waMessageId }).eq("id", message.id).is("wa_message_id", null);
    await admin.rpc("record_usage", { p_business_id: p.businessId, p_metric: "messages", p_quantity: 1 });
    log.info("whatsapp.message.sent", { message_id: message.id, wa_message_id: waMessageId, type: p.type });
    return { messageId: message.id, waMessageId };
  } catch (err) {
    const reason = err instanceof GraphApiError && err.isOutsideWindow ? "window_closed" : "send_failed";
    const text = err instanceof Error ? err.message : String(err);
    await admin.from("messages").update({ status: "failed", error: text.slice(0, 1000) }).eq("id", message.id);
    log.error("whatsapp.message.send_failed", err, { message_id: message.id });
    throw new OutboundMessageError(
      reason === "window_closed" ? "WhatsApp rejected the message because the 24-hour window is closed." : `WhatsApp didn't accept the message: ${text}`,
      reason,
    );
  }
}

/**
 * "Send test" from Settings → WhatsApp. If the recipient messaged this number
 * in the last 24 hours, a plain text message is allowed; otherwise WhatsApp
 * requires an approved template. Real WhatsApp Business accounts don't have
 * Meta's sample `hello_world`, so we use whichever approved template on the
 * account can be sent without parameters.
 */
export async function sendTestMessage(admin: DbClient, p: { businessId: string; accountId: string; toWaId: string; userId: string }) {
  const { data: customer } = await admin.from("customers").select("id").eq("business_id", p.businessId).eq("wa_id", p.toWaId).maybeSingle();
  if (customer) {
    const { data: conv } = await admin
      .from("conversations")
      .select("id, last_customer_message_at")
      .eq("business_id", p.businessId)
      .eq("customer_id", customer.id)
      .eq("whatsapp_account_id", p.accountId)
      .eq("status", "open")
      .maybeSingle();
    if (conv && isWithinServiceWindow(conv.last_customer_message_at)) {
      await sendConversationText(admin, {
        businessId: p.businessId,
        conversationId: conv.id,
        body: "✅ SellFlow test message: this WhatsApp number is connected and working.",
        sender: "staff",
        senderUserId: p.userId,
      });
      return { kind: "text" as const };
    }
  }

  const { data: account } = await admin.from("whatsapp_accounts").select("waba_id, display_phone_number").eq("business_id", p.businessId).eq("id", p.accountId).maybeSingle();
  if (!account) throw new OutboundMessageError("WhatsApp number not found.", "not_found");
  const { wa } = await getClientForAccount(admin, p.businessId, p.accountId);
  let templates;
  try {
    templates = await wa.listTemplates(account.waba_id);
  } catch (err) {
    logger.warn("whatsapp.test.templates_failed", { business_id: p.businessId, error: err instanceof Error ? err.message : String(err) });
    throw new OutboundMessageError("We couldn't read this account's message templates from Meta. Please try again.", "send_failed");
  }
  const approved = templates.filter((t) => t.status === "APPROVED");
  const pick = approved.find((t) => t.name === "hello_world") ?? approved.find(templateNeedsNoParameters);
  if (!pick) {
    throw new OutboundMessageError(
      `This WhatsApp account has no approved message template SellFlow can send as a test. Send any message (e.g. "hi") from your phone to ${account.display_phone_number ?? "this number"}, then click Send test again — SellFlow will reply with a normal message.`,
      "send_failed",
    );
  }
  await sendTemplateToNumber(admin, {
    businessId: p.businessId,
    accountId: p.accountId,
    toWaId: p.toWaId,
    template: { name: pick.name, language: pick.language },
    sender: "staff",
    senderUserId: p.userId,
  });
  return { kind: "template" as const, name: pick.name };
}
