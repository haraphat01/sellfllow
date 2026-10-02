/**
 * Integration: full AI turns against a real Supabase project, with a scripted
 * model (no AI Gateway needed) and the local mock Graph API for sending.
 *
 *   RUN_INTEGRATION=1 E2E_BUSINESS_ID=<id> (env from .env + e2e env) npx vitest run tests/integration
 *
 * Requires: scripts/mock-graph.mjs running, META_GRAPH_BASE_URL pointing at it,
 * and the business seeded with scripts/e2e-seed-inbox.mjs (fake number + encrypted token).
 */
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { scriptedModel } from "../helpers/mock-model";

const run = Boolean(process.env.RUN_INTEGRATION && process.env.E2E_BUSINESS_ID);
const BIZ = process.env.E2E_BUSINESS_ID ?? "";

describe.skipIf(!run)("AI agent turn (integration)", { timeout: 60_000 }, async () => {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { respondToConversation } = await import("@/services/ai/agent.service");
  const { AISdkProvider } = await import("@/services/ai/provider");
  const { HANDOFF_LINE } = await import("@/services/ai/prompt");

  const admin = createAdminClient();
  const created: { customers: string[] } = { customers: [] };
  let accountId = "";
  let productId = "";
  let agentWasEnabled = false;

  const providerFor = (steps: Parameters<typeof scriptedModel>[0], onCall?: () => Promise<void>) => {
    const model = scriptedModel(steps);
    const original = model.doGenerate.bind(model);
    model.doGenerate = async (opts) => {
      await onCall?.();
      return original(opts);
    };
    return new AISdkProvider(() => model);
  };

  async function fixture(text: string) {
    const waId = `23490${randomBytes(4).readUInt32BE() % 100000000}`.slice(0, 13);
    const { data: c } = await admin.from("customers").insert({ business_id: BIZ, wa_id: waId, phone: `+${waId}`, profile_name: "Test Buyer" }).select("id").single();
    created.customers.push(c!.id);
    const now = new Date().toISOString();
    const { data: conv } = await admin
      .from("conversations")
      .insert({ business_id: BIZ, customer_id: c!.id, whatsapp_account_id: accountId, last_customer_message_at: now, last_message_at: now })
      .select("id")
      .single();
    await admin.from("messages").insert({ business_id: BIZ, conversation_id: conv!.id, direction: "inbound", sender: "customer", body: text, status: "received", wa_message_id: `wamid.INT.${randomBytes(8).toString("hex")}` });
    return conv!.id;
  }

  async function outbound(conversationId: string) {
    const { data } = await admin.from("messages").select("body, sender, status, ai_request_id").eq("conversation_id", conversationId).eq("direction", "outbound");
    return data ?? [];
  }

  beforeAll(async () => {
    const { data: acc } = await admin.from("whatsapp_accounts").select("id").eq("business_id", BIZ).eq("verified_name", "Mock Business").single();
    accountId = acc!.id;
    const { data: p } = await admin.from("products").select("id, price_minor").eq("business_id", BIZ).eq("sku", "BAG-BLK-01").single();
    productId = p!.id;
    const { data: agent } = await admin.from("ai_agents").select("enabled").eq("business_id", BIZ).single();
    agentWasEnabled = agent!.enabled;
    await admin.from("ai_agents").update({ enabled: true }).eq("business_id", BIZ);
    await admin.from("ai_settings").update({ delivery_zones: [{ name: "Lagos Mainland", fee_minor: 300000, eta: "1-2 days" }] }).eq("business_id", BIZ);
  });

  afterAll(async () => {
    await admin.from("ai_agents").update({ enabled: agentWasEnabled }).eq("business_id", BIZ);
    if (created.customers.length) {
      // Release stock reserved by test orders, then remove them.
      const { data: orders } = await admin.from("orders").select("id, status").in("customer_id", created.customers);
      for (const o of orders ?? []) {
        if (o.status === "pending_payment") await admin.rpc("cancel_order", { p_business_id: BIZ, p_order_id: o.id, p_reason: "integration test cleanup" });
      }
      await admin.from("orders").delete().in("customer_id", created.customers);
      await admin.from("conversations").delete().in("customer_id", created.customers);
      await admin.from("customers").delete().in("id", created.customers);
    }
  });

  it("answers a price question from the catalogue and sends it", async () => {
    const id = await fixture("Hi, how much is the black bag?");
    const provider = providerFor([{ tool: "search_products", input: { query: "black bag" } }, { text: "The *Black Leather Bag* is ₦46,000 and it's in stock. Would you like to order one?" }]);
    const res = await respondToConversation(admin, { businessId: BIZ, conversationId: id }, { provider });

    expect(res.outcome).toBe("replied");
    const out = await outbound(id);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sender: "ai", status: "sent", body: "The *Black Leather Bag* is ₦46,000 and it's in stock. Would you like to order one?" });

    const rid = res.outcome === "replied" ? res.aiRequestId : "";
    const { data: actions } = await admin.from("ai_actions").select("tool_name, status, output").eq("ai_request_id", rid);
    expect(actions?.map((a) => a.tool_name)).toEqual(["search_products"]);
    expect(JSON.stringify(actions?.[0].output)).toContain("Black Leather Bag");
    const { data: usage } = await admin.from("ai_usage").select("input_tokens, output_tokens").eq("ai_request_id", rid).single();
    expect(usage).toMatchObject({ input_tokens: 200, output_tokens: 40 });
  });

  it("blocks an invented price and hands over to a human", async () => {
    const id = await fixture("How much is the red bag?");
    const res = await respondToConversation(admin, { businessId: BIZ, conversationId: id }, { provider: providerFor([{ text: "The red bag is ₦38,000 today only!" }]) });

    expect(res.outcome).toBe("replied");
    const out = await outbound(id);
    expect(out.map((m) => m.body)).toEqual([HANDOFF_LINE]);
    const { data: conv } = await admin.from("conversations").select("ai_mode, needs_attention, purchase_stage").eq("id", id).single();
    expect(conv).toMatchObject({ ai_mode: "HUMAN_ACTIVE", needs_attention: true, purchase_stage: "human_handoff" });
    const { data: guard } = await admin.from("ai_actions").select("status").eq("conversation_id", id).eq("tool_name", "guardrail.price_grounding").single();
    expect(guard?.status).toBe("denied");
  });

  it("accepts delivery fees and totals that tools returned", async () => {
    const id = await fixture("How much to deliver the black bag to Yaba?");
    const provider = providerFor([
      { tool: "search_products", input: { query: "black bag" } },
      { tool: "get_business_policy", input: { topic: "delivery" } },
      { text: "The bag is ₦46,000 plus ₦3,000 delivery to Lagos Mainland — ₦49,000 in total." },
    ]);
    const res = await respondToConversation(admin, { businessId: BIZ, conversationId: id }, { provider });
    expect(res.outcome).toBe("replied");
    expect((await outbound(id))[0].body).toContain("₦49,000");
  });

  it("does nothing when a human is handling the conversation", async () => {
    const id = await fixture("hello?");
    await admin.from("conversations").update({ ai_mode: "HUMAN_ACTIVE" }).eq("id", id);
    const res = await respondToConversation(admin, { businessId: BIZ, conversationId: id }, { provider: providerFor([{ text: "hi" }]) });
    expect(res).toEqual({ outcome: "skipped", reason: "ai mode HUMAN_ACTIVE" });
    expect(await outbound(id)).toHaveLength(0);
  });

  it("drops the reply if a human takes over while the AI is thinking", async () => {
    const id = await fixture("Is it available?");
    const provider = providerFor([{ text: "Yes it is!" }], async () => {
      await admin.from("conversations").update({ ai_mode: "HUMAN_ACTIVE" }).eq("id", id);
    });
    const res = await respondToConversation(admin, { businessId: BIZ, conversationId: id }, { provider });
    expect(res.outcome).toBe("dropped");
    expect(await outbound(id)).toHaveLength(0);
  });

  it("records purchase state and hands over when the customer is ready to order", async () => {
    const id = await fixture("I'll take one black bag, deliver to Yaba. I'm Ngozi.");
    const provider = providerFor([
      { tool: "update_conversation_state", input: { stage: "purchase_intent", product_id: productId, quantity: 1, customer_name: "Ngozi", delivery_location: "Yaba" } },
      { tool: "handoff_to_human", input: { reason: "ready_to_order", summary: "Ngozi wants 1 Black Leather Bag delivered to Yaba." } },
      { text: "Lovely! A member of our team will complete your order shortly." },
    ]);
    const res = await respondToConversation(admin, { businessId: BIZ, conversationId: id }, { provider });
    expect(res).toMatchObject({ outcome: "replied", handoff: true });

    const { data: conv } = await admin.from("conversations").select("ai_mode, needs_attention, sales_outcome, state, customers(name)").eq("id", id).single();
    expect(conv).toMatchObject({ ai_mode: "HUMAN_ACTIVE", needs_attention: true, sales_outcome: "interested_not_purchased" });
    expect(conv?.state).toMatchObject({ product_name: "Black Leather Bag", quantity: 1, delivery_location: "Yaba", customer_name: "Ngozi" });
    expect(conv?.customers).toMatchObject({ name: "Ngozi" });
    const { data: ev } = await admin.from("conversation_events").select("type, actor_type, data").eq("conversation_id", id).eq("type", "handoff_requested").single();
    expect(ev).toMatchObject({ actor_type: "ai" });
  });

  it("tools cannot reach products outside the business", async () => {
    const id = await fixture("tell me about product 123");
    const provider = providerFor([{ tool: "get_product", input: { product_id: "00000000-0000-4000-8000-000000000001" } }, { text: "I couldn't find that product." }]);
    const res = await respondToConversation(admin, { businessId: BIZ, conversationId: id }, { provider });
    const rid = res.outcome === "replied" ? res.aiRequestId : "";
    const { data: a } = await admin.from("ai_actions").select("output").eq("ai_request_id", rid).single();
    expect(a?.output).toMatchObject({ found: false });
  });

  it("quotes, refuses to order in the same turn, then orders after the customer confirms", async () => {
    const { data: small } = await admin.from("product_variants").select("id, stock_quantity").eq("product_id", productId).eq("name", "Small").single();
    const id = await fixture("I want the black bag in Small, delivered to 12 Herbert Macaulay Way, Yaba (Lagos Mainland). I'm Ngozi Obi.");

    // Turn 1: record details, quote, try to jump ahead (must be refused), show the breakdown.
    const turn1 = await respondToConversation(admin, { businessId: BIZ, conversationId: id }, {
      provider: providerFor([
        { tool: "update_conversation_state", input: { product_id: productId, variant_id: small!.id, quantity: 1, customer_name: "Ngozi Obi", delivery_address: "12 Herbert Macaulay Way, Yaba", delivery_zone: "Lagos Mainland" } },
        { tool: "calculate_order_total", input: { items: [{ product_id: productId, variant_id: small!.id, quantity: 1 }], delivery_zone: "Lagos Mainland" } },
        { tool: "create_order", input: { confirmed: true } },
        { text: "Black Leather Bag (Small) ₦46,000 + delivery to Lagos Mainland ₦3,000 = *₦49,000*. Shall I place the order?" },
      ]),
    });
    expect(turn1.outcome).toBe("replied");
    const rid1 = turn1.outcome === "replied" ? turn1.aiRequestId : "";
    const { data: early } = await admin.from("ai_actions").select("output").eq("ai_request_id", rid1).eq("tool_name", "create_order").single();
    expect(early?.output).toMatchObject({ ok: false });
    let { data: conv } = await admin.from("conversations").select("purchase_stage, state").eq("id", id).single();
    expect(conv?.purchase_stage).toBe("order_confirmation");
    expect((conv?.state as { pending_quote?: { total_minor: number } }).pending_quote?.total_minor).toBe(4_900_000);
    expect(await admin.from("orders").select("id", { count: "exact", head: true }).eq("conversation_id", id).then((r) => r.count)).toBe(0);

    // Customer confirms.
    await admin.from("messages").insert({ business_id: BIZ, conversation_id: id, direction: "inbound", sender: "customer", body: "Yes please", status: "received", wa_message_id: `wamid.INT.${randomBytes(8).toString("hex")}` });

    // Turn 2: create the order from the stored quote.
    const turn2 = await respondToConversation(admin, { businessId: BIZ, conversationId: id }, {
      provider: providerFor([
        { tool: "create_order", input: { confirmed: true } },
        { text: "Done! Order placed: Black Leather Bag (Small) ₦46,000 + delivery ₦3,000 — total ₦49,000. We'll send payment details shortly." },
      ]),
    });
    expect(turn2).toMatchObject({ outcome: "replied", handoff: false });
    const { data: confirmation } = await admin.from("messages").select("body").eq("conversation_id", id).eq("sender", "ai").order("created_at", { ascending: false }).limit(1).single();
    expect(confirmation?.body).toContain("₦46,000");

    const { data: order } = await admin.from("orders").select("id, status, source, ai_assisted, total_minor, delivery_fee_minor, customer_name, delivery_address, confirmed_by_customer_at, order_items(name, variant_label, quantity, unit_price_minor)").eq("conversation_id", id).single();
    expect(order).toMatchObject({ status: "pending_payment", source: "ai", ai_assisted: true, total_minor: 4_900_000, delivery_fee_minor: 300_000, customer_name: "Ngozi Obi" });
    expect(order?.delivery_address).toMatchObject({ address: "12 Herbert Macaulay Way, Yaba", zone: "Lagos Mainland" });
    expect(order?.confirmed_by_customer_at).toBeTruthy();
    expect(order?.order_items).toEqual([{ name: "Black Leather Bag", variant_label: "Small", quantity: 1, unit_price_minor: 4_600_000 }]);

    const { data: smallAfter } = await admin.from("product_variants").select("stock_quantity").eq("id", small!.id).single();
    expect(smallAfter?.stock_quantity).toBe(small!.stock_quantity - 1);

    ({ data: conv } = await admin.from("conversations").select("purchase_stage, needs_attention, state").eq("id", id).single());
    // Without Paystack the team must collect payment, so the conversation is flagged.
    const { canCollectPayments } = await import("@/services/payments/payments.service");
    expect(conv).toMatchObject({ purchase_stage: "payment_pending", needs_attention: !(await canCollectPayments(admin, BIZ)) });
    expect((conv?.state as Record<string, unknown>).pending_quote).toBeUndefined();
    const { data: ev } = await admin.from("conversation_events").select("type").eq("conversation_id", id).eq("type", "order_created");
    expect(ev).toHaveLength(1);
  });

  it("keeps the quote when tools run in parallel (regression: quote wiped by concurrent state update)", async () => {
    const { data: small } = await admin.from("product_variants").select("id").eq("product_id", productId).eq("name", "Small").single();
    const id = await fixture("Black bag, Small, to 12 Herbert Macaulay Way Yaba (Lagos Mainland). I'm Ngozi Obi.");
    await respondToConversation(admin, { businessId: BIZ, conversationId: id }, {
      provider: providerFor([
        {
          parallel: [
            { tool: "calculate_order_total", input: { items: [{ product_id: productId, variant_id: small!.id, quantity: 1 }], delivery_zone: "Lagos Mainland" } },
            { tool: "update_conversation_state", input: { stage: "order_confirmation", intent: "purchase", product_id: productId, variant_id: small!.id, quantity: 1, customer_name: "Ngozi Obi", delivery_address: "12 Herbert Macaulay Way, Yaba", delivery_zone: "Lagos Mainland" } },
          ],
        },
        { text: "Black Leather Bag (Small) ₦46,000 + delivery ₦3,000 = *₦49,000*. Shall I go ahead?" },
      ]),
    });
    const { data: conv } = await admin.from("conversations").select("state").eq("id", id).single();
    expect((conv?.state as { pending_quote?: unknown; customer_name?: string }).pending_quote).toBeTruthy();
    expect((conv?.state as { customer_name?: string }).customer_name).toBe("Ngozi Obi");

    await admin.from("messages").insert({ business_id: BIZ, conversation_id: id, direction: "inbound", sender: "customer", body: "Yes, go ahead.", status: "received", wa_message_id: `wamid.INT.${randomBytes(8).toString("hex")}` });
    await respondToConversation(admin, { businessId: BIZ, conversationId: id }, {
      provider: providerFor([{ tool: "create_order", input: { confirmed: true } }, { text: "Your order is placed — total ₦49,000." }]),
    });
    const { data: order } = await admin.from("orders").select("status, total_minor").eq("conversation_id", id).single();
    expect(order).toMatchObject({ status: "pending_payment", total_minor: 4_900_000 });
  });

  it("refuses to create an order the customer was never shown", async () => {
    const id = await fixture("ok go ahead");
    await admin
      .from("conversations")
      .update({
        state: {
          customer_name: "Tunde",
          delivery_address: "5 Allen Avenue, Ikeja",
          pending_quote: { quote_id: "q-hidden", items: [{ product_id: productId, variant_id: null, quantity: 1 }], delivery_zone: null, total_minor: 4_600_000, quoted_at: new Date(Date.now() - 60_000).toISOString() },
        },
      })
      .eq("id", id);
    const res = await respondToConversation(admin, { businessId: BIZ, conversationId: id }, { provider: providerFor([{ tool: "create_order", input: { confirmed: true } }, { text: "Let me show you the total first." }]) });
    const rid = res.outcome === "replied" ? res.aiRequestId : "";
    const { data: a } = await admin.from("ai_actions").select("output").eq("ai_request_id", rid).eq("tool_name", "create_order").single();
    expect(a?.output).toMatchObject({ ok: false });
    expect(await admin.from("orders").select("id", { count: "exact", head: true }).eq("conversation_id", id).then((r) => r.count)).toBe(0);
  });

  it("stays quiet when the assistant is switched off", async () => {
    const id = await fixture("hi");
    await admin.from("ai_agents").update({ enabled: false }).eq("business_id", BIZ);
    const res = await respondToConversation(admin, { businessId: BIZ, conversationId: id }, { provider: providerFor([{ text: "hi" }]) });
    await admin.from("ai_agents").update({ enabled: true }).eq("business_id", BIZ);
    expect(res).toEqual({ outcome: "skipped", reason: "agent disabled" });
  });
});
