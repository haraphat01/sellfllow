/**
 * Integration: Paystack payment path against a real Supabase project, the
 * running app (webhook route + Inngest jobs), the local mock Paystack
 * (scripts/mock-paystack.mjs) and mock Graph API (scripts/mock-graph.mjs).
 *
 *   RUN_INTEGRATION=1 E2E_BUSINESS_ID=<id> PAYSTACK_BASE_URL=http://127.0.0.1:8298 npm run test:integration
 */
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { scriptedModel } from "../helpers/mock-model";

const run = Boolean(process.env.RUN_INTEGRATION && process.env.E2E_BUSINESS_ID && process.env.PAYSTACK_BASE_URL && process.env.PAYSTACK_SECRET_KEY);
const BIZ = process.env.E2E_BUSINESS_ID ?? "";
const APP = process.env.E2E_APP_URL ?? "http://localhost:3000";
const MOCK = process.env.PAYSTACK_BASE_URL ?? "";
// Payments are collected through SellFlow's platform account (bank payouts), so webhooks are signed with its key.
const KEY = process.env.PAYSTACK_SECRET_KEY ?? "";

describe.skipIf(!run)("Paystack payments (integration)", { timeout: 90_000 }, async () => {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { signPaystackPayload } = await import("@/lib/paystack/signature");
  const payments = await import("@/services/payments/payments.service");
  const payouts = await import("@/services/payments/payouts.service");
  const { respondToConversation } = await import("@/services/ai/agent.service");
  const { AISdkProvider } = await import("@/services/ai/provider");
  const provider = (steps: Parameters<typeof scriptedModel>[0]) => new AISdkProvider(() => scriptedModel(steps));

  const admin = createAdminClient();
  let customerId = "";
  let conversationId = "";
  let previousPayout: Record<string, unknown> | null = null;
  let ownerId = "";
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function webhook(payload: unknown, key = KEY, signed = true) {
    const raw = JSON.stringify(payload);
    const res = await fetch(`${APP}/api/webhooks/paystack`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(signed ? { "x-paystack-signature": signPaystackPayload(raw, key) } : {}) },
      body: raw,
    });
    return res.status;
  }
  const RUN = Date.now() % 1_000_000_000;
  const charge = (reference: string, id: number) => ({ event: "charge.success", data: { id: RUN * 100 + id, reference, amount: 0, currency: "NGN", status: "success" } });

  async function newOrder(key: string) {
    const { data: bag } = await admin.from("products").select("id").eq("business_id", BIZ).eq("sku", "BELT-BRN-32").single();
    const { data: orderId, error } = await admin.rpc("create_order", {
      p_business_id: BIZ,
      p_customer_id: customerId,
      p_conversation_id: conversationId,
      p_items: [{ product_id: bag!.id, quantity: 1 }],
      p_delivery_zone: "Lagos Mainland",
      p_delivery_address: "12 Herbert Macaulay Way, Yaba",
      p_customer_name: "Pay Tester",
      p_source: "ai",
      p_ai_assisted: true,
      p_idempotency_key: key,
    });
    if (error) throw error;
    return orderId as string;
  }

  const createdCustomers: string[] = [];
  async function newConversation() {
    const { data: acc } = await admin.from("whatsapp_accounts").select("id").eq("business_id", BIZ).eq("verified_name", "Mock Business").single();
    const wa = `23491${randomBytes(4).readUInt32BE() % 100000000}`.slice(0, 13);
    const { data: c } = await admin.from("customers").insert({ business_id: BIZ, wa_id: wa, phone: `+${wa}`, name: "Pay Tester" }).select("id").single();
    createdCustomers.push(c!.id);
    const now = new Date().toISOString();
    const { data: conv } = await admin
      .from("conversations")
      .insert({ business_id: BIZ, customer_id: c!.id, whatsapp_account_id: acc!.id, last_customer_message_at: now, sales_outcome: "interested_not_purchased", needs_attention: true })
      .select("id")
      .single();
    return { customerId: c!.id, conversationId: conv!.id };
  }

  beforeAll(async () => {
    const { data: prev } = await admin.from("payout_accounts").select("*").eq("business_id", BIZ).maybeSingle();
    previousPayout = prev;
    await admin.from("payout_accounts").delete().eq("business_id", BIZ);
    const { data: owner } = await admin.from("business_members").select("user_id").eq("business_id", BIZ).eq("role", "owner").single();
    ownerId = owner!.user_id;
    await payouts.connectPayoutAccount(admin, { businessId: BIZ, bankCode: "058", accountNumber: "0123456789", userId: ownerId });
    ({ customerId, conversationId } = await newConversation());
  });

  afterAll(async () => {
    const { data: orders } = await admin.from("orders").select("id, status").in("customer_id", createdCustomers);
    for (const o of orders ?? []) {
      if (o.status === "pending_payment") await admin.rpc("cancel_order", { p_business_id: BIZ, p_order_id: o.id, p_reason: "test cleanup" });
    }
    // Paid/refunded test orders: return their stock too.
    const { data: bag } = await admin.from("products").select("id").eq("business_id", BIZ).eq("sku", "BELT-BRN-32").single();
    const notReleased = (orders ?? []).filter((o) => o.status !== "pending_payment" && o.status !== "cancelled").length;
    if (notReleased) {
      const { data: p } = await admin.from("products").select("stock_quantity").eq("id", bag!.id).single();
      await admin.from("products").update({ stock_quantity: p!.stock_quantity + notReleased }).eq("id", bag!.id);
    }
    await admin.from("orders").delete().in("customer_id", createdCustomers);
    await admin.from("conversations").delete().in("customer_id", createdCustomers);
    await admin.from("customers").delete().in("id", createdCustomers);
    await admin.from("payout_accounts").delete().eq("business_id", BIZ);
    if (previousPayout) await admin.from("payout_accounts").insert(previousPayout as never);
    await admin.from("notifications").delete().eq("business_id", BIZ).like("type", "payouts.%");
  });

  it("creates a payment link and reuses it", async () => {
    const orderId = await newOrder(`pay-int-link-${Date.now()}`);
    const a = await payments.createPaymentLink(admin, { businessId: BIZ, orderId });
    expect(a.url).toContain("/checkout/");
    expect(a.amountMinor).toBe(1_550_000);
    const b = await payments.createPaymentLink(admin, { businessId: BIZ, orderId });
    expect(b).toMatchObject({ url: a.url, reference: a.reference, reused: true });
  });

  it("confirms a real payment via signed webhook, once, and messages the customer", async () => {
    const orderId = await newOrder(`pay-int-ok-${Date.now()}`);
    const link = await payments.createPaymentLink(admin, { businessId: BIZ, orderId });

    // Unsigned or wrongly signed: rejected, nothing recorded.
    expect(await webhook(charge(link.reference, 1), KEY, false)).toBe(401);
    expect(await webhook(charge(link.reference, 1), "sk_test_attacker_key_000000000000000")).toBe(401);

    // Correctly signed but Paystack says it isn't paid (forged/early event): not marked paid.
    expect(await webhook(charge(link.reference, 2))).toBe(200);
    let { data: order } = await admin.from("orders").select("status").eq("id", orderId).single();
    expect(order?.status).toBe("pending_payment");

    // Customer actually pays.
    await fetch(`${MOCK}/__pay/${encodeURIComponent(link.reference)}`, { method: "POST" });
    expect(await webhook(charge(link.reference, 3))).toBe(200);
    ({ data: order } = await admin.from("orders").select("status, paid_at").eq("id", orderId).single());
    expect(order?.status).toBe("paid");
    const { data: pay } = await admin.from("payments").select("status, channel, verified_at").eq("reference", link.reference).single();
    expect(pay).toMatchObject({ status: "success", channel: "card" });
    const { data: cust } = await admin.from("customers").select("total_orders, total_spend_minor, status").eq("id", customerId).single();
    expect(cust).toMatchObject({ total_orders: 1, total_spend_minor: 1_550_000, status: "customer" });
    const { data: conv } = await admin.from("conversations").select("sales_outcome, purchase_stage, needs_attention").eq("id", conversationId).single();
    expect(conv).toMatchObject({ sales_outcome: "purchased", purchase_stage: "paid", needs_attention: false });

    // Replay: duplicate, no double counting.
    expect(await webhook(charge(link.reference, 3))).toBe(200);
    const { data: cust2 } = await admin.from("customers").select("total_orders").eq("id", customerId).single();
    expect(cust2?.total_orders).toBe(1);

    // WhatsApp confirmation (Inngest job → mock Graph).
    let confirmation: { body: string | null; status: string } | undefined;
    for (let i = 0; i < 20 && !confirmation; i++) {
      await sleep(1500);
      const { data } = await admin.from("messages").select("body, status").eq("conversation_id", conversationId).eq("sender", "system").like("body", "✅ Payment received%");
      confirmation = data?.[0];
    }
    expect(confirmation?.body).toContain("₦15,500");
    expect(confirmation?.status).toBe("sent");
  });

  it("AI: creates the order, sends the payment link, and only says 'paid' after Paystack confirms", async () => {
    const { data: agent } = await admin.from("ai_agents").select("enabled").eq("business_id", BIZ).single();
    await admin.from("ai_agents").update({ enabled: true }).eq("business_id", BIZ);
    const { conversationId: aiConv } = await newConversation();
    const conversationId = aiConv;
    try {
      const { data: belt } = await admin.from("products").select("id").eq("business_id", BIZ).eq("sku", "BELT-BRN-32").single();
      // Quote was shown in an earlier turn; the customer has now said yes.
      await admin.from("conversations").update({
        ai_mode: "AI_ACTIVE",
        state: {
          customer_name: "Pay Tester",
          delivery_address: "12 Herbert Macaulay Way, Yaba",
          pending_quote: { quote_id: `q-${Date.now()}`, items: [{ product_id: belt!.id, variant_id: null, quantity: 1 }], delivery_zone: "Lagos Mainland", total_minor: 1_550_000, quoted_at: new Date(Date.now() - 60_000).toISOString() },
        },
      }).eq("id", conversationId);
      // Explicit timestamps on both rows: in a bulk insert, a column missing from one row is sent as NULL.
      const { error: seedError } = await admin.from("messages").insert([
        { business_id: BIZ, conversation_id: conversationId, direction: "outbound", sender: "ai", body: "Belt ₦12,500 + delivery ₦3,000 = ₦15,500. Shall I place it?", status: "sent", created_at: new Date(Date.now() - 50_000).toISOString(), wa_message_id: null },
        { business_id: BIZ, conversation_id: conversationId, direction: "inbound", sender: "customer", body: "Yes please", status: "received", created_at: new Date().toISOString(), wa_message_id: `wamid.PAY.${randomBytes(6).toString("hex")}` },
      ]);
      expect(seedError).toBeNull();

      const r1 = await respondToConversation(admin, { businessId: BIZ, conversationId }, {
        provider: provider([
          { tool: "create_order", input: { confirmed: true } },
          { tool: "create_payment_link", input: {} },
          { text: "Order placed — total ₦15,500. Pay securely here: {{LINK}}" },
        ]),
      });
      expect(r1, JSON.stringify(r1)).toMatchObject({ outcome: "replied", handoff: false });
      const { data: order } = await admin.from("orders").select("id, order_number, status").eq("conversation_id", conversationId).eq("status", "pending_payment").order("created_at", { ascending: false }).limit(1).single();
      const { data: pay } = await admin.from("payments").select("reference, authorization_url").eq("order_id", order!.id).single();
      expect(pay?.authorization_url).toContain("/checkout/");

      // Customer claims they paid before paying: the AI must not confirm.
      await admin.from("messages").insert({ business_id: BIZ, conversation_id: conversationId, direction: "inbound", sender: "customer", body: "I've paid", status: "received", wa_message_id: `wamid.PAY.${randomBytes(6).toString("hex")}` });
      await respondToConversation(admin, { businessId: BIZ, conversationId }, { provider: provider([{ tool: "get_payment_status", input: {} }, { text: "I can't see the payment yet — please complete checkout with the link." }]) });
      const { data: early } = await admin.from("ai_actions").select("output").eq("conversation_id", conversationId).eq("tool_name", "get_payment_status").order("created_at", { ascending: false }).limit(1).single();
      expect(early?.output).toMatchObject({ paid: false });

      // After a real payment, the tool confirms it (and marks the order paid without a webhook).
      await fetch(`${MOCK}/__pay/${encodeURIComponent(pay!.reference)}`, { method: "POST" });
      await admin.from("messages").insert({ business_id: BIZ, conversation_id: conversationId, direction: "inbound", sender: "customer", body: "Done now", status: "received", wa_message_id: `wamid.PAY.${randomBytes(6).toString("hex")}` });
      await respondToConversation(admin, { businessId: BIZ, conversationId }, { provider: provider([{ tool: "get_payment_status", input: {} }, { text: "Payment confirmed — thank you!" }]) });
      const { data: late } = await admin.from("ai_actions").select("output").eq("conversation_id", conversationId).eq("tool_name", "get_payment_status").order("created_at", { ascending: false }).limit(1).single();
      expect(late?.output).toMatchObject({ paid: true });
      const { data: paidOrder } = await admin.from("orders").select("status").eq("id", order!.id).single();
      expect(paidOrder?.status).toBe("paid");
    } finally {
      await admin.from("ai_agents").update({ enabled: agent!.enabled }).eq("business_id", BIZ);
    }
  });

  it("rejects a payment whose amount doesn't match the order", async () => {
    const orderId = await newOrder(`pay-int-tamper-${Date.now()}`);
    const link = await payments.createPaymentLink(admin, { businessId: BIZ, orderId });
    await fetch(`${MOCK}/__pay/${encodeURIComponent(link.reference)}`, { method: "POST", body: JSON.stringify({ amount: 100 }) });
    expect(await webhook(charge(link.reference, 10))).toBe(500);
    const { data: order } = await admin.from("orders").select("status").eq("id", orderId).single();
    expect(order?.status).toBe("pending_payment");
    const { data: ev } = await admin.from("payment_events").select("status, error").eq("event_key", `charge.success:${RUN * 100 + 10}`).single();
    expect(ev?.status).toBe("failed");
    expect(ev?.error).toMatch(/amount mismatch/);
  });

  it("refunds a paid order when Paystack confirms the refund", async () => {
    const orderId = await newOrder(`pay-int-refund-${Date.now()}`);
    const link = await payments.createPaymentLink(admin, { businessId: BIZ, orderId });
    await fetch(`${MOCK}/__pay/${encodeURIComponent(link.reference)}`, { method: "POST" });
    await payments.refreshOrderPayment(admin, { businessId: BIZ, orderId });
    await payments.requestRefund(admin, { businessId: BIZ, orderId, userId: ownerId });
    const { data: requested } = await admin.from("payments").select("refund_requested_at").eq("reference", link.reference).single();
    expect(requested?.refund_requested_at).toBeTruthy();
    expect(await webhook({ event: "refund.processed", data: { id: RUN * 100 + 77, transaction_reference: link.reference, amount: 1_550_000, status: "processed" } })).toBe(200);
    const { data: order } = await admin.from("orders").select("status").eq("id", orderId).single();
    expect(order?.status).toBe("refunded");
  });
});
