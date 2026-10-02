/**
 * Integration: the AI answers from the business's Q&A (scripted model) against
 * a real Supabase project and a private mock Graph API.
 *
 *   RUN_INTEGRATION=1 E2E_BUSINESS_ID=<id> npm run test:integration   (with the E2E env)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { scriptedModel } from "../helpers/mock-model";

const run = Boolean(process.env.RUN_INTEGRATION && process.env.E2E_BUSINESS_ID && process.env.CREDENTIALS_ENCRYPTION_KEY);
const BIZ = process.env.E2E_BUSINESS_ID ?? "";
const PORT = 8394;

describe.skipIf(!run)("Business Q&A knowledge base (integration)", { timeout: 60_000 }, async () => {
  const saved = process.env.META_GRAPH_BASE_URL;
  process.env.META_GRAPH_BASE_URL = `http://127.0.0.1:${PORT}`;

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { respondToConversation } = await import("@/services/ai/agent.service");
  const { AISdkProvider } = await import("@/services/ai/provider");
  const { searchFaqs } = await import("@/services/knowledge/faqs.service");
  const { HANDOFF_LINE } = await import("@/services/ai/prompt");
  const provider = (steps: Parameters<typeof scriptedModel>[0]) => new AISdkProvider(() => scriptedModel(steps));

  const admin = createAdminClient();
  let mock: ChildProcess;
  let conversationId = "";
  let customerId = "";
  let agentWasEnabled = false;
  const faqIds: string[] = [];
  const ask = (body: string) =>
    admin.from("messages").insert({ business_id: BIZ, conversation_id: conversationId, direction: "inbound", sender: "customer", body, status: "received", created_at: new Date().toISOString(), wa_message_id: `wamid.FAQ.${randomBytes(6).toString("hex")}` });
  const lastReply = async () => (await admin.from("messages").select("body").eq("conversation_id", conversationId).eq("sender", "ai").order("created_at", { ascending: false }).limit(1).maybeSingle()).data?.body;

  beforeAll(async () => {
    mock = spawn(process.execPath, ["scripts/mock-graph.mjs", String(PORT)], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) {
      if (await fetch(`http://127.0.0.1:${PORT}/__number/1`).then(() => true, () => false)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const { data: rows } = await admin
      .from("business_faqs")
      .insert([
        { business_id: BIZ, question: "Do you deliver outside Lagos?", answer: "Yes — Ilorin and Ibadan for ₦2,000, in 2–3 days.", keywords: ["waybill"] },
        { business_id: BIZ, question: "Can I pick up my order?", answer: "Yes, from 12 Herbert Macaulay Way, Yaba, 9am–6pm.", keywords: ["pickup", "collect"] },
      ])
      .select("id");
    faqIds.push(...(rows ?? []).map((r) => r.id));
    const { data: agent } = await admin.from("ai_agents").select("enabled").eq("business_id", BIZ).single();
    agentWasEnabled = agent!.enabled;
    await admin.from("ai_agents").update({ enabled: true }).eq("business_id", BIZ);
    const { data: acc } = await admin.from("whatsapp_accounts").select("id").eq("business_id", BIZ).eq("verified_name", "Mock Business").single();
    const wa = `23495${randomBytes(4).readUInt32BE() % 100000000}`.padEnd(13, "0").slice(0, 13);
    const { data: c } = await admin.from("customers").insert({ business_id: BIZ, wa_id: wa, phone: `+${wa}`, name: "Faq Tester" }).select("id").single();
    customerId = c!.id;
    const { data: conv } = await admin.from("conversations").insert({ business_id: BIZ, customer_id: customerId, whatsapp_account_id: acc!.id, last_customer_message_at: new Date().toISOString() }).select("id").single();
    conversationId = conv!.id;
  });

  afterAll(async () => {
    if (faqIds.length) await admin.from("business_faqs").delete().in("id", faqIds);
    await admin.from("conversations").delete().eq("customer_id", customerId);
    await admin.from("customers").delete().eq("id", customerId);
    await admin.from("ai_agents").update({ enabled: agentWasEnabled }).eq("business_id", BIZ);
    mock?.kill();
    process.env.META_GRAPH_BASE_URL = saved;
  });

  it("finds the right answer for real customer phrasing", async () => {
    expect((await searchFaqs(admin, BIZ, "abeg una dey deliver for ilorin?", 3))[0]?.question).toBe("Do you deliver outside Lagos?");
    expect((await searchFaqs(admin, BIZ, "can i come collect it myself", 3))[0]?.question).toBe("Can I pick up my order?");
    // Another business never sees these.
    const { data: other } = await admin.from("businesses").select("id").neq("id", BIZ).limit(1).single();
    expect(await searchFaqs(admin, other!.id, "deliver outside Lagos", 3)).toEqual([]);
  });

  it("the AI answers from the Q&A, including its price", async () => {
    await ask("Do you deliver to Ilorin? How much?");
    const r = await respondToConversation(admin, { businessId: BIZ, conversationId }, {
      provider: provider([{ tool: "search_business_info", input: { question: "deliver to Ilorin how much" } }, { text: "Yes! We deliver to Ilorin for ₦2,000, in 2–3 days." }]),
    });
    expect(r, JSON.stringify(r)).toMatchObject({ outcome: "replied" });
    expect(await lastReply()).toBe("Yes! We deliver to Ilorin for ₦2,000, in 2–3 days.");
  });

  it("an invented price is still blocked, and an unknown question gets no answer to copy", async () => {
    await ask("And to Abuja?");
    const r = await respondToConversation(admin, { businessId: BIZ, conversationId }, {
      provider: provider([{ tool: "search_business_info", input: { question: "deliver to Abuja" } }, { text: "Abuja delivery is ₦3,500." }]),
    });
    // ₦3,500 isn't in any tool result: the reply is replaced by the hand-off line and a person takes over.
    expect(r).toMatchObject({ outcome: "replied", handoff: true });
    const blocked = await lastReply();
    expect(blocked).not.toContain("₦3,500");
    expect(blocked).toBe(HANDOFF_LINE);
    await admin.from("conversations").update({ ai_mode: "AI_ACTIVE" }).eq("id", conversationId);

    await ask("Do you sell gift cards?");
    await respondToConversation(admin, { businessId: BIZ, conversationId }, {
      provider: provider([{ tool: "search_business_info", input: { question: "gift cards" } }, { text: "I'm not sure about that — let me connect you with the team." }]),
    });
    const { data: action } = await admin.from("ai_actions").select("output").eq("conversation_id", conversationId).eq("tool_name", "search_business_info").order("created_at", { ascending: false }).limit(1).single();
    expect(action!.output).toMatchObject({ found: false });
  });
});
