import "server-only";

import { randomUUID } from "node:crypto";

import { isModelAvailable, serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/observability/logger";
import type { DbClient } from "@/lib/supabase/types";
import { getPlan, isOverLimit, isSubscriptionUsable } from "@/services/billing/limits";
import { isBankTransferEnabled } from "@/services/payments/bank-transfer.service";
import { canCollectPayments } from "@/services/payments/payments.service";
import { isWithinServiceWindow, sendConversationText } from "@/services/whatsapp/outbound.service";

import { checkPriceGrounding, collectGroundedAmounts } from "./grounding";
import { buildSystemPrompt, buildTranscript, HANDOFF_LINE, toWhatsAppText, type PromptCapabilities } from "./prompt";
import { getAIProvider, type AIMessage, type AIProvider, type AIToolCall } from "./provider";
import { applyHandoff, createSalesTools, type ToolContext } from "./tools";

export type RespondOutcome =
  | { outcome: "replied"; aiRequestId: string; messageId: string; handoff: boolean }
  | { outcome: "handoff"; aiRequestId: string; reason: string }
  | { outcome: "skipped"; reason: string }
  | { outcome: "dropped"; aiRequestId: string; reason: string };

/** Orders are always on; Paystack links when set up; bank transfer when the business enabled it. */
async function capabilitiesFor(admin: DbClient, businessId: string): Promise<PromptCapabilities> {
  const [payments, bankTransfer] = await Promise.all([canCollectPayments(admin, businessId), isBankTransferEnabled(admin, businessId)]);
  return { orders: true, payments, bankTransfer };
}

async function loadAgentContext(admin: DbClient, businessId: string) {
  const [{ data: business }, { data: agent }, { data: settings }] = await Promise.all([
    admin.from("businesses").select("id, name, description, industry, currency, timezone, phone, address, website, status").eq("id", businessId).single(),
    admin.from("ai_agents").select("*").eq("business_id", businessId).single(),
    admin.from("ai_settings").select("*").eq("business_id", businessId).single(),
  ]);
  if (!business || !agent || !settings) throw new Error("AI configuration missing for business");
  return { business, agent, settings };
}

function policiesFrom(settings: Awaited<ReturnType<typeof loadAgentContext>>["settings"]) {
  return {
    return_policy: settings.return_policy,
    delivery_policy: settings.delivery_policy,
    business_hours: settings.business_hours,
    discount_rules: settings.discount_rules,
    max_discount_percent: Number(settings.max_discount_percent ?? 0),
    escalation_rules: settings.escalation_rules,
    payment_rules: settings.payment_rules,
    has_delivery_zones: Array.isArray(settings.delivery_zones) && settings.delivery_zones.length > 0,
  };
}

/**
 * Generates and sends the AI reply for a conversation. Safe to call more than
 * once: it re-checks everything (AI still in charge, customer spoke last,
 * 24h window, quota) immediately before doing work and before sending.
 */
export async function respondToConversation(
  admin: DbClient,
  p: { businessId: string; conversationId: string },
  deps: { provider?: AIProvider; now?: Date } = {},
): Promise<RespondOutcome> {
  const now = deps.now ?? new Date();
  const provider = deps.provider ?? getAIProvider();
  const log = logger.child({ business_id: p.businessId, conversation_id: p.conversationId });

  const { data: conv } = await admin
    .from("conversations")
    .select("id, status, ai_mode, state, last_customer_message_at, whatsapp_account_id, customers!inner(id, name, profile_name, total_orders, opted_out_at)")
    .eq("business_id", p.businessId)
    .eq("id", p.conversationId)
    .maybeSingle();
  if (!conv) return { outcome: "skipped", reason: "conversation not found" };
  if (conv.status !== "open") return { outcome: "skipped", reason: "conversation closed" };
  if (conv.ai_mode !== "AI_ACTIVE") return { outcome: "skipped", reason: `ai mode ${conv.ai_mode}` };
  // Opting out stops unsolicited messages (follow-ups, campaigns); replies to the customer's own messages continue.
  const customer = conv.customers as unknown as { id: string; name: string | null; profile_name: string | null; total_orders: number; opted_out_at: string | null };
  if (!isWithinServiceWindow(conv.last_customer_message_at, now)) return { outcome: "skipped", reason: "outside 24h window" };

  const { business, agent, settings } = await loadAgentContext(admin, p.businessId);
  if (business.status !== "active") return { outcome: "skipped", reason: "business not active" };
  if (!agent.enabled) return { outcome: "skipped", reason: "agent disabled" };
  // Without credentials for the chosen model, stay silent rather than failing and handing off every conversation.
  if (!deps.provider && !isModelAvailable(agent.model || serverEnv().AI_DEFAULT_MODEL)) return { outcome: "skipped", reason: "ai not configured" };

  const { data: recent } = await admin
    .from("messages")
    .select("id, direction, sender, type, body, created_at")
    .eq("business_id", p.businessId)
    .eq("conversation_id", p.conversationId)
    .order("created_at", { ascending: false })
    .limit(20);
  const history = (recent ?? []).reverse();
  const last = history.at(-1);
  if (!last || last.direction !== "inbound") return { outcome: "skipped", reason: "customer did not speak last" };

  const aiRequestId = `air_${randomUUID()}`;
  const alog = log.child({ ai_request_id: aiRequestId, message_id: last.id });

  // Plan checks before spending tokens.
  const plan = await getPlan(admin, p.businessId);
  if (!plan || !isSubscriptionUsable(plan.status)) {
    await applyHandoff(admin, { businessId: p.businessId, conversationId: p.conversationId, reason: "subscription", summary: "The AI is off because the subscription isn't active.", aiRequestId });
    return { outcome: "handoff", aiRequestId, reason: "subscription inactive" };
  }
  // Monthly message allowance (AI replies count as messages).
  if (await isOverLimit(admin, p.businessId, plan, "messages", now)) {
    await applyHandoff(admin, { businessId: p.businessId, conversationId: p.conversationId, reason: "plan_limit", summary: "Monthly message limit reached — please reply manually or upgrade.", aiRequestId });
    alog.warn("ai.message_limit_reached");
    return { outcome: "handoff", aiRequestId, reason: "message limit reached" };
  }
  // Customer limit: customers beyond the plan's allowance are served by the team, not the AI.
  const customerLimit = plan.limits.customers;
  if (customerLimit !== null && customerLimit !== undefined) {
    const { data: me } = await admin.from("customers").select("created_at").eq("id", customer.id).single();
    const { count: before } = await admin.from("customers").select("id", { count: "exact", head: true }).eq("business_id", p.businessId).lt("created_at", me!.created_at);
    if ((before ?? 0) >= customerLimit) {
      await applyHandoff(admin, { businessId: p.businessId, conversationId: p.conversationId, reason: "plan_limit", summary: "Customer limit reached on your plan — the AI doesn't reply to new customers. Please reply manually or upgrade.", aiRequestId });
      return { outcome: "handoff", aiRequestId, reason: "customer limit reached" };
    }
  }
  const { data: allowed, error: quotaError } = await admin.rpc("claim_ai_conversation", {
    p_business_id: p.businessId,
    p_conversation_id: p.conversationId,
    p_limit: (plan.limits.monthly_ai_conversations ?? null) as number,
  });
  if (quotaError) throw quotaError;
  if (!allowed) {
    await applyHandoff(admin, { businessId: p.businessId, conversationId: p.conversationId, reason: "plan_limit", summary: "Monthly AI conversation limit reached — please reply manually or upgrade.", aiRequestId });
    alog.warn("ai.quota_exceeded");
    return { outcome: "handoff", aiRequestId, reason: "plan limit reached" };
  }

  const turn: ToolContext["turn"] = { outputs: [], state: (conv.state ?? {}) as Record<string, unknown>, handoff: null };
  const capabilities = await capabilitiesFor(admin, p.businessId);
  const tools = createSalesTools({
    admin,
    businessId: p.businessId,
    conversationId: p.conversationId,
    customerId: customer.id,
    currency: business.currency,
    aiRequestId,
    dryRun: false,
    turn,
    turnStartedAt: now,
    assistantTexts: history.filter((m) => m.direction === "outbound" && m.body).slice(-6).map((m) => m.body as string),
    capabilities,
  });

  const system = buildSystemPrompt({
    business,
    agent,
    policies: policiesFrom(settings),
    state: turn.state,
    customer: { name: customer.name ?? customer.profile_name, is_returning: customer.total_orders > 0 },
    capabilities,
    now,
  });
  const messages = buildTranscript(history as never);
  const model = agent.model || serverEnv().AI_DEFAULT_MODEL;

  const started = Date.now();
  const response = await provider.generateResponse({ model, system, messages, tools, maxSteps: 6 });
  const latency = Date.now() - started;

  await admin.from("ai_usage").insert({
    business_id: p.businessId,
    conversation_id: p.conversationId,
    ai_request_id: aiRequestId,
    model: response.model,
    input_tokens: response.usage.inputTokens,
    output_tokens: response.usage.outputTokens,
    latency_ms: latency,
  });

  // Guardrails on the final text.
  let text = toWhatsAppText(response.text);
  let handedOff = Boolean(turn.handoff);
  const grounding = checkPriceGrounding(text, collectGroundedAmounts(turn.outputs));
  if (!grounding.ok) {
    alog.warn("ai.guardrail.ungrounded_price", { ungrounded: grounding.ungrounded });
    await admin.from("ai_actions").insert({
      business_id: p.businessId,
      conversation_id: p.conversationId,
      ai_request_id: aiRequestId,
      tool_name: "guardrail.price_grounding",
      input: { reply: text },
      output: { ungrounded_minor: grounding.ungrounded },
      status: "denied",
    });
    if (!handedOff) {
      await applyHandoff(admin, { businessId: p.businessId, conversationId: p.conversationId, reason: "unsure", summary: "The AI's reply mentioned a price it couldn't verify, so it wasn't sent. Please reply to the customer.", aiRequestId });
      handedOff = true;
    }
    text = HANDOFF_LINE;
  }
  if (!text) {
    if (!handedOff) return { outcome: "dropped", aiRequestId, reason: "empty reply" };
    text = HANDOFF_LINE;
  }

  // Re-check right before sending: a human may have taken over, or the customer
  // may have written again (a newer run will answer both).
  const { data: fresh } = await admin.from("conversations").select("ai_mode, status").eq("id", p.conversationId).single();
  const { data: newest } = await admin
    .from("messages")
    .select("id, direction")
    .eq("conversation_id", p.conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  const stillOurs = fresh?.status === "open" && (fresh.ai_mode === "AI_ACTIVE" || (handedOff && fresh.ai_mode === "HUMAN_ACTIVE"));
  if (!stillOurs) {
    alog.info("ai.reply.dropped_takeover");
    return { outcome: "dropped", aiRequestId, reason: "human took over during generation" };
  }
  if (newest && newest.id !== last.id) {
    alog.info("ai.reply.dropped_newer_message");
    return { outcome: "dropped", aiRequestId, reason: "newer message arrived" };
  }

  const sent = await sendConversationText(admin, {
    businessId: p.businessId,
    conversationId: p.conversationId,
    body: text,
    sender: "ai",
    aiRequestId,
  });
  alog.info("ai.reply.sent", { tool_calls: response.toolCalls.length, latency_ms: latency, handoff: handedOff });
  return { outcome: "replied", aiRequestId, messageId: sent.messageId, handoff: handedOff };
}

/**
 * Playground: runs the agent against the business's real catalogue and
 * policies for a hypothetical chat, without writing anything or sending.
 */
export async function previewAgentReply(
  admin: DbClient,
  p: { businessId: string; messages: AIMessage[]; state?: Record<string, unknown> },
  deps: { provider?: AIProvider; now?: Date } = {},
): Promise<{ text: string; toolCalls: AIToolCall[]; blocked: boolean; handoff: { reason: string; summary: string } | null; usage: { inputTokens: number; outputTokens: number }; state: Record<string, unknown> }> {
  const now = deps.now ?? new Date();
  const provider = deps.provider ?? getAIProvider();
  const { business, agent, settings } = await loadAgentContext(admin, p.businessId);

  const turn: ToolContext["turn"] = { outputs: [], state: p.state ?? {}, handoff: null };
  const capabilities = await capabilitiesFor(admin, p.businessId);
  const aiRequestId = `air_preview_${randomUUID()}`;
  const tools = createSalesTools({
    admin,
    businessId: p.businessId,
    conversationId: "00000000-0000-0000-0000-000000000000",
    customerId: "00000000-0000-0000-0000-000000000000",
    currency: business.currency,
    aiRequestId,
    dryRun: true,
    turn,
    turnStartedAt: now,
    assistantTexts: p.messages.filter((m) => m.role === "assistant").slice(-6).map((m) => m.content),
    capabilities,
  });

  const response = await provider.generateResponse({
    model: agent.model || serverEnv().AI_DEFAULT_MODEL,
    system: buildSystemPrompt({ business, agent, policies: policiesFrom(settings), state: turn.state, customer: { name: null, is_returning: false }, capabilities, now }),
    messages: p.messages,
    tools,
    maxSteps: 6,
  });

  await admin.from("ai_usage").insert({
    business_id: p.businessId,
    ai_request_id: aiRequestId,
    model: response.model,
    input_tokens: response.usage.inputTokens,
    output_tokens: response.usage.outputTokens,
  });

  let text = toWhatsAppText(response.text);
  const grounding = checkPriceGrounding(text, collectGroundedAmounts(turn.outputs));
  if (!grounding.ok) text = HANDOFF_LINE;
  return { text: text || (turn.handoff ? HANDOFF_LINE : ""), toolCalls: response.toolCalls, blocked: !grounding.ok, handoff: turn.handoff, usage: response.usage, state: turn.state };
}
