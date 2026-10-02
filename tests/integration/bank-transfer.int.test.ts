/**
 * Integration: manual bank transfer, end to end through the AI agent (scripted
 * model) against a real Supabase project, with a private mock Graph API.
 * Only a person can confirm a transfer; nothing automatic may mark it paid.
 *
 *   RUN_INTEGRATION=1 E2E_BUSINESS_ID=<id> npm run test:integration   (with the E2E env)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { scriptedModel } from "../helpers/mock-model";

const run = Boolean(process.env.RUN_INTEGRATION && process.env.E2E_BUSINESS_ID && process.env.CREDENTIALS_ENCRYPTION_KEY);
const BIZ = process.env.E2E_BUSINESS_ID ?? "";
const PORT = 8395;

describe.skipIf(!run)("Manual bank transfer (integration)", { timeout: 90_000 }, async () => {
  const saved = process.env.META_GRAPH_BASE_URL;
  process.env.META_GRAPH_BASE_URL = `http://127.0.0.1:${PORT}`; // read once: set before importing app modules

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { respondToConversation } = await import("@/services/ai/agent.service");
  const { AISdkProvider } = await import("@/services/ai/provider");
  const bt = await import("@/services/payments/bank-transfer.service");
  const payments = await import("@/services/payments/payments.service");
  const { notifyPaymentReceived } = await import("@/services/payments/notify.service");
  const provider = (steps: Parameters<typeof scriptedModel>[0]) => new AISdkProvider(() => scriptedModel(steps));

  const admin = createAdminClient();
  let mock: ChildProcess;
  let userId = "";
  let conversationId = "";
  let customerId = "";
  let savedSettings: Record<string, unknown> | null = null;
  let agentWasEnabled = false;
  const inbound = (extra: Record<string, unknown>) =>
    admin.from("messages").insert({ business_id: BIZ, conversation_id: conversationId, direction: "inbound", sender: "customer", status: "received", wa_message_id: `wamid.BT.${randomBytes(6).toString("hex")}`, created_at: new Date().toISOString(), ...extra }).select("id").single();
  const lastAction = async (tool: string) =>
    (await admin.from("ai_actions").select("output").eq("conversation_id", conversationId).eq("tool_name", tool).order("created_at", { ascending: false }).limit(1).single()).data?.output as Record<string, unknown>;

  beforeAll(async () => {
    mock = spawn(process.execPath, ["scripts/mock-graph.mjs", String(PORT)], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) {
      if (await fetch(`http://127.0.0.1:${PORT}/__number/1`).then(() => true, () => false)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const { data: anyone } = await admin.from("profiles").select("id").limit(1).single();
    userId = anyone!.id;
    const { data: s } = await admin.from("bank_transfer_settings").select("*").eq("business_id", BIZ).maybeSingle();
    savedSettings = s;
    await bt.saveBankTransferSettings(admin, { businessId: BIZ, userId, enabled: true, bankName: "GTBank", accountNumber: "0123456789", accountName: "AISHA FASHION E2E", instructions: null });
    const { data: agent } = await admin.from("ai_agents").select("enabled").eq("business_id", BIZ).single();
    agentWasEnabled = agent!.enabled;
    await admin.from("ai_agents").update({ enabled: true }).eq("business_id", BIZ);

    // A customer who has just confirmed a quote.
    const { data: acc } = await admin.from("whatsapp_accounts").select("id").eq("business_id", BIZ).eq("verified_name", "Mock Business").single();
    const wa = `23494${randomBytes(4).readUInt32BE() % 100000000}`.padEnd(13, "0").slice(0, 13);
    const { data: c } = await admin.from("customers").insert({ business_id: BIZ, wa_id: wa, phone: `+${wa}`, name: "Transfer Tester" }).select("id").single();
    customerId = c!.id;
    const { data: belt } = await admin.from("products").select("id").eq("business_id", BIZ).eq("sku", "BELT-BRN-32").single();
    const { data: conv } = await admin
      .from("conversations")
      .insert({
        business_id: BIZ,
        customer_id: customerId,
        whatsapp_account_id: acc!.id,
        last_customer_message_at: new Date().toISOString(),
        sales_outcome: "interested_not_purchased",
        state: {
          customer_name: "Transfer Tester",
          delivery_address: "5 Akata Alanamu, Ilorin",
          pending_quote: { quote_id: `q-${Date.now()}`, items: [{ product_id: belt!.id, variant_id: null, quantity: 1 }], delivery_zone: "Lagos Mainland", total_minor: 1_550_000, quoted_at: new Date(Date.now() - 60_000).toISOString() },
        },
      })
      .select("id")
      .single();
    conversationId = conv!.id;
    await admin.from("messages").insert([
      { business_id: BIZ, conversation_id: conversationId, direction: "outbound", sender: "ai", body: "Belt ₦12,500 + delivery ₦3,000 = ₦15,500. Shall I place it?", status: "sent", created_at: new Date(Date.now() - 50_000).toISOString(), wa_message_id: null },
      { business_id: BIZ, conversation_id: conversationId, direction: "inbound", sender: "customer", body: "Yes, I'll pay by transfer", status: "received", created_at: new Date().toISOString(), wa_message_id: `wamid.BT.${randomBytes(6).toString("hex")}` },
    ]);
  });

  afterAll(async () => {
    const { data: orders } = await admin.from("orders").select("id, status").eq("customer_id", customerId);
    for (const o of orders ?? []) if (o.status === "pending_payment") await admin.rpc("cancel_order", { p_business_id: BIZ, p_order_id: o.id, p_reason: "test cleanup" });
    const paid = (orders ?? []).filter((o) => o.status === "paid").length;
    if (paid) {
      const { data: p } = await admin.from("products").select("id, stock_quantity").eq("business_id", BIZ).eq("sku", "BELT-BRN-32").single();
      await admin.from("products").update({ stock_quantity: p!.stock_quantity + paid }).eq("id", p!.id);
    }
    await admin.from("orders").delete().eq("customer_id", customerId);
    await admin.from("conversations").delete().eq("customer_id", customerId);
    await admin.from("customers").delete().eq("id", customerId);
    await admin.from("ai_agents").update({ enabled: agentWasEnabled }).eq("business_id", BIZ);
    if (savedSettings) await admin.from("bank_transfer_settings").upsert(savedSettings as never);
    else await admin.from("bank_transfer_settings").delete().eq("business_id", BIZ);
    await admin.from("notifications").delete().eq("business_id", BIZ).eq("type", "payment.claimed");
    mock?.kill();
    process.env.META_GRAPH_BASE_URL = saved;
  });

  it("AI places the order and shares the business's bank details (no Paystack link)", async () => {
    const r = await respondToConversation(admin, { businessId: BIZ, conversationId }, {
      provider: provider([
        { tool: "create_order", input: { confirmed: true } },
        { tool: "get_bank_transfer_details", input: {} },
        { text: "Order placed! Please transfer ₦15,500 to GTBank 0123456789 (AISHA FASHION E2E) with the narration shown, then send your receipt here." },
      ]),
    });
    expect(r, JSON.stringify(r)).toMatchObject({ outcome: "replied" });
    const details = await lastAction("get_bank_transfer_details");
    expect(details).toMatchObject({ ok: true, bank_name: "GTBank", account_number: "0123456789", account_name: "AISHA FASHION E2E", amount_minor: 1_550_000 });
    const { data: order } = await admin.from("orders").select("id, order_number, status").eq("conversation_id", conversationId).single();
    expect(order!.status).toBe("pending_payment");
    expect(details.narration).toBe(`Order ${order!.order_number}`);
    const { data: pays } = await admin.from("payments").select("collection_mode, provider, status").eq("order_id", order!.id);
    expect(pays).toEqual([{ collection_mode: "bank_transfer", provider: "bank_transfer", status: "initialized" }]);
  });

  it("the customer's receipt is attached to a claim — the order stays unpaid and the team is alerted", async () => {
    const { data: receipt } = await inbound({ type: "image", body: null, content: { raw: { type: "image", image: { id: "1234567890", mime_type: "image/jpeg" } } } });
    await inbound({ type: "text", body: "I've paid, see receipt" });
    await respondToConversation(admin, { businessId: BIZ, conversationId }, {
      provider: provider([{ tool: "record_payment_claim", input: {} }, { tool: "get_payment_status", input: {} }, { text: "Thanks! I've passed your receipt to the team — they'll confirm shortly." }]),
    });
    expect(await lastAction("record_payment_claim")).toMatchObject({ ok: true, receipt_attached: true });
    expect(await lastAction("get_payment_status")).toMatchObject({ paid: false, status: "bank transfer awaiting confirmation by the team" });

    const { data: order } = await admin.from("orders").select("id, status").eq("conversation_id", conversationId).single();
    expect(order!.status).toBe("pending_payment");
    const { data: pay } = await admin.from("payments").select("id, status, claimed_at, proof_message_id").eq("order_id", order!.id).single();
    expect(pay).toMatchObject({ status: "pending", proof_message_id: receipt!.id });
    expect(pay!.claimed_at).toBeTruthy();
    const { data: conv } = await admin.from("conversations").select("needs_attention").eq("id", conversationId).single();
    expect(conv!.needs_attention).toBe(true);
    const { count } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("business_id", BIZ).eq("type", "payment.claimed").contains("data", { order_id: order!.id });
    expect(count).toBe(1);

    // Nothing automatic can mark it paid: not the Paystack check, not the database transition.
    await expect(payments.confirmPayment(admin, { businessId: BIZ, paymentId: pay!.id })).rejects.toThrow(/confirmed by the team/);
    expect(await payments.refreshOrderPayment(admin, { businessId: BIZ, orderId: order!.id })).toBeNull();
    const { error } = await admin.rpc("mark_payment_succeeded", {
      p_business_id: BIZ, p_payment_id: pay!.id, p_amount_minor: 1_550_000, p_currency: "NGN", p_paid_at: new Date().toISOString(), p_channel: "bank_transfer", p_provider_transaction_id: null as unknown as string, p_provider_response: {},
    });
    expect(error?.code).toBe("23514"); // check_violation: a person must confirm
  });

  it("'Not received' clears the claim and tells the customer; a person's confirmation then marks it paid", async () => {
    const { data: order } = await admin.from("orders").select("id, order_number").eq("conversation_id", conversationId).single();
    await bt.rejectBankTransfer(admin, { businessId: BIZ, orderId: order!.id, userId, note: "Nothing in GTBank yet" });
    const { data: rejected } = await admin.from("payments").select("status, claimed_at, rejection_note").eq("order_id", order!.id).single();
    expect(rejected).toEqual({ status: "initialized", claimed_at: null, rejection_note: "Nothing in GTBank yet" });
    const { data: notice } = await admin.from("messages").select("body, status").eq("conversation_id", conversationId).eq("direction", "outbound").order("created_at", { ascending: false }).limit(1).single();
    expect(notice!.body).toContain(`haven't received your transfer for order #${order!.order_number}`);
    expect(notice!.body).not.toContain("GTBank yet"); // internal note stays internal

    await bt.recordPaymentClaim(admin, { businessId: BIZ, orderId: order!.id, conversationId, proofMessageId: null });
    const res = await bt.confirmBankTransfer(admin, { businessId: BIZ, orderId: order!.id, userId });
    expect(res.outcome).toBe("paid");
    const { data: paid } = await admin.from("orders").select("status").eq("id", order!.id).single();
    expect(paid!.status).toBe("paid");
    const { data: pay } = await admin.from("payments").select("status, channel, confirmed_by").eq("order_id", order!.id).single();
    expect(pay).toEqual({ status: "success", channel: "bank_transfer", confirmed_by: userId });

    // The customer gets the usual WhatsApp confirmation.
    expect(await notifyPaymentReceived(admin, { businessId: BIZ, orderId: order!.id })).toEqual({ notified: "customer" });
    const { data: confirm } = await admin.from("messages").select("body").eq("conversation_id", conversationId).eq("sender", "system").order("created_at", { ascending: false }).limit(1).single();
    expect(confirm!.body).toContain(`Payment received for order #${order!.order_number}`);
  });
});
