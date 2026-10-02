/**
 * Integration: abandoned-lead recovery against a real Supabase project, the
 * running app (WhatsApp webhook + Inngest jobs for STOP/START) and the mock
 * Graph API (scripts/mock-graph.mjs).
 *
 *   RUN_INTEGRATION=1 E2E_BUSINESS_ID=<id> META_GRAPH_BASE_URL=http://127.0.0.1:8299 npm run test:integration
 */
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { textMessagePayload } from "../fixtures/whatsapp";

const run = Boolean(process.env.RUN_INTEGRATION && process.env.E2E_BUSINESS_ID && process.env.META_GRAPH_BASE_URL);
const BIZ = process.env.E2E_BUSINESS_ID ?? "";
const APP = process.env.E2E_APP_URL ?? "http://localhost:3000";

describe.skipIf(!run)("Follow-ups (integration)", { timeout: 90_000 }, async () => {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { signMetaPayload } = await import("@/lib/whatsapp/signature");
  const { processFollowUp, scheduleFollowUps } = await import("@/services/automation/follow-ups.service");
  const { findEventsToRetry } = await import("@/services/whatsapp/inbound.service");

  const admin = createAdminClient();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

  let account = { id: "", phone_number_id: "" };
  let product = { id: "", name: "" };
  let originalSettings: Record<string, unknown> = {};
  let originalPlanId = "";
  const createdCustomers: string[] = [];
  const createdEvents: string[] = [];

  async function lead(opts: { quietMinutes?: number; productId?: string | null } = {}) {
    const wa = `23492${randomBytes(4).readUInt32BE() % 100000000}`.padEnd(13, "0").slice(0, 13);
    const { data: c } = await admin.from("customers").insert({ business_id: BIZ, wa_id: wa, phone: `+${wa}`, name: "Chioma Okafor" }).select("id").single();
    createdCustomers.push(c!.id);
    const at = minsAgo(opts.quietMinutes ?? 30);
    const productId = opts.productId === undefined ? product.id : opts.productId;
    const { data: conv } = await admin
      .from("conversations")
      .insert({
        business_id: BIZ,
        customer_id: c!.id,
        whatsapp_account_id: account.id,
        sales_outcome: "interested_not_purchased",
        purchase_stage: "purchase_intent",
        purchase_intent_at: at,
        last_message_at: at,
        last_customer_message_at: at,
        state: productId ? { product_id: productId, intent: "purchase" } : {},
      })
      .select("id")
      .single();
    return { waId: wa, customerId: c!.id, conversationId: conv!.id };
  }

  async function scheduledFor(conversationId: string) {
    await scheduleFollowUps(admin);
    const { data } = await admin.from("follow_ups").select("id, status, scheduled_for, sequence_number").eq("conversation_id", conversationId).eq("status", "scheduled").maybeSingle();
    return data;
  }

  async function lastOutbound(conversationId: string) {
    const { data } = await admin.from("messages").select("sender, body, type, status").eq("conversation_id", conversationId).eq("direction", "outbound").order("created_at", { ascending: false }).limit(1).maybeSingle();
    return data;
  }

  async function customerSays(waId: string, body: string) {
    const raw = JSON.stringify(textMessagePayload({ id: `wamid.fu-${randomBytes(8).toString("hex")}`, from: waId, body, phoneNumberId: account.phone_number_id, ts: Math.floor(Date.now() / 1000) }));
    const res = await fetch(`${APP}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": signMetaPayload(raw, process.env.META_APP_SECRET ?? "") },
      body: raw,
    });
    expect(res.status).toBe(200);
  }

  async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 30_000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error("timed out");
      await sleep(1000);
    }
  }

  beforeAll(async () => {
    const { data: acc } = await admin.from("whatsapp_accounts").select("id, phone_number_id").eq("business_id", BIZ).eq("verified_name", "Mock Business").single();
    account = acc!;
    const { data: p } = await admin.from("products").select("id, name").eq("business_id", BIZ).eq("sku", "BELT-BRN-32").single();
    product = p!;
    const { data: s } = await admin.from("ai_settings").select("*").eq("business_id", BIZ).single();
    originalSettings = s!;
    const { data: sub } = await admin.from("subscriptions").select("plan_id").eq("business_id", BIZ).single();
    originalPlanId = sub!.plan_id;
    const { data: growth } = await admin.from("subscription_plans").select("id").eq("code", "growth").single();
    await admin.from("subscriptions").update({ plan_id: growth!.id }).eq("business_id", BIZ);
    await admin
      .from("ai_settings")
      .update({ follow_up_enabled: true, follow_up_delay_minutes: 15, follow_up_max: 2, follow_up_message: null, follow_up_respect_hours: false, follow_up_template_name: null })
      .eq("business_id", BIZ);
  });

  afterAll(async () => {
    const { data: orders } = await admin.from("orders").select("id, status").in("customer_id", createdCustomers);
    for (const o of orders ?? []) {
      if (o.status === "pending_payment") await admin.rpc("cancel_order", { p_business_id: BIZ, p_order_id: o.id, p_reason: "test cleanup" });
    }
    await admin.from("orders").delete().in("customer_id", createdCustomers);
    await admin.from("conversations").delete().in("customer_id", createdCustomers);
    await admin.from("customers").delete().in("id", createdCustomers);
    if (createdEvents.length) await admin.from("whatsapp_events").delete().in("id", createdEvents);
    const restore = Object.fromEntries(Object.entries(originalSettings).filter(([k]) => k.startsWith("follow_up_") || k === "attribution_window_hours"));
    await admin.from("ai_settings").update(restore as never).eq("business_id", BIZ);
    await admin.from("subscriptions").update({ plan_id: originalPlanId }).eq("business_id", BIZ);
  });

  it("follows up a quiet lead once, about the product, then waits for new activity", async () => {
    const l = await lead();
    const fu = await scheduledFor(l.conversationId);
    expect(fu).toMatchObject({ sequence_number: 1 });
    expect(new Date(fu!.scheduled_for).getTime()).toBeLessThanOrEqual(Date.now());

    const res = await processFollowUp(admin, fu!.id);
    expect(res).toMatchObject({ outcome: "sent", channel: "text" });
    const msg = await lastOutbound(l.conversationId);
    expect(msg).toMatchObject({ sender: "automation", status: "sent" });
    expect(msg!.body).toBe(`Hi Chioma 👋 Just checking in about the ${product.name} you asked about — it's still available. Would you like me to help you complete your order?`);
    const { data: row } = await admin.from("follow_ups").select("status, channel, message_id, sent_at").eq("id", fu!.id).single();
    expect(row).toMatchObject({ status: "sent", channel: "text" });
    expect(row!.message_id).toBeTruthy();
    const { count } = await admin.from("conversation_events").select("id", { count: "exact", head: true }).eq("conversation_id", l.conversationId).eq("type", "follow_up_sent");
    expect(count).toBe(1);

    // Sending again is a no-op; no second follow-up until the quiet period passes again.
    expect(await processFollowUp(admin, fu!.id)).toMatchObject({ outcome: "noop" });
    const next = await scheduledFor(l.conversationId);
    expect(next).toMatchObject({ sequence_number: 2 });
    expect(new Date(next!.scheduled_for).getTime()).toBeGreaterThan(Date.now() + 10 * 60_000);
  });

  it("re-times after new activity and respects sending hours", async () => {
    const l = await lead();
    const fu = await scheduledFor(l.conversationId);
    // The customer spoke 2 minutes ago: push back a full quiet period.
    await admin.from("conversations").update({ last_message_at: minsAgo(2), last_customer_message_at: minsAgo(2) }).eq("id", l.conversationId);
    const r1 = await processFollowUp(admin, fu!.id);
    expect(r1).toMatchObject({ outcome: "rescheduled", reason: "recent_activity" });

    // Quiet again, but outside the sending window (a 1-hour window that excludes now).
    await admin.from("conversations").update({ last_message_at: minsAgo(30) }).eq("id", l.conversationId);
    await admin.from("follow_ups").update({ scheduled_for: minsAgo(1) }).eq("id", fu!.id);
    const lagosHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    const start = (lagosHour + 2) % 23;
    await admin.from("ai_settings").update({ follow_up_respect_hours: true, follow_up_window_start: start, follow_up_window_end: start + 1 }).eq("business_id", BIZ);
    try {
      const r2 = await processFollowUp(admin, fu!.id);
      expect(r2).toMatchObject({ outcome: "rescheduled", reason: "outside_sending_hours" });
      expect(new Date((r2 as { at: string }).at).getTime()).toBeGreaterThan(Date.now());
    } finally {
      await admin.from("ai_settings").update({ follow_up_respect_hours: false }).eq("business_id", BIZ);
    }
    expect(await lastOutbound(l.conversationId)).toBeNull();
  });

  it("reminds about an unpaid order with its payment link", async () => {
    const l = await lead();
    const { data: orderId, error } = await admin.rpc("create_order", {
      p_business_id: BIZ,
      p_customer_id: l.customerId,
      p_conversation_id: l.conversationId,
      p_items: [{ product_id: product.id, quantity: 1 }],
      p_delivery_zone: "Lagos Mainland",
      p_delivery_address: "12 Herbert Macaulay Way, Yaba",
      p_customer_name: "Chioma Okafor",
      p_source: "ai",
      p_ai_assisted: true,
      p_idempotency_key: `fu-int-${Date.now()}`,
    });
    if (error) throw error;
    const { data: order } = await admin.from("orders").select("order_number, total_minor, currency").eq("id", orderId as string).single();
    await admin.from("payments").insert({
      business_id: BIZ,
      order_id: orderId as string,
      reference: `sf-fu-${randomBytes(5).toString("hex")}`,
      amount_minor: order!.total_minor,
      currency: order!.currency,
      authorization_url: "https://checkout.paystack.com/fu-test",
    });
    const fu = await scheduledFor(l.conversationId);
    expect(await processFollowUp(admin, fu!.id)).toMatchObject({ outcome: "sent" });
    const msg = await lastOutbound(l.conversationId);
    expect(msg!.body).toContain(`Your order #${order!.order_number}`);
    expect(msg!.body).toContain("https://checkout.paystack.com/fu-test");
    const { data: row } = await admin.from("follow_ups").select("order_id").eq("id", fu!.id).single();
    expect(row!.order_id).toBe(orderId);
  });

  it("skips out-of-stock products and closed 24h windows; uses a template when configured", async () => {
    const { data: empty } = await admin
      .from("products")
      .insert({ business_id: BIZ, name: `Sold-out test ${Date.now()}`, price_minor: 100000, stock_quantity: 0 })
      .select("id")
      .single();
    try {
      const soldOut = await lead({ productId: empty!.id });
      const f1 = await scheduledFor(soldOut.conversationId);
      expect(await processFollowUp(admin, f1!.id)).toMatchObject({ outcome: "skipped", reason: "out_of_stock" });
      // Skipped attempts don't loop.
      expect(await scheduledFor(soldOut.conversationId)).toBeNull();
    } finally {
      await admin.from("products").delete().eq("id", empty!.id);
    }

    const late = await lead({ productId: null });
    await admin.from("conversations").update({ last_customer_message_at: minsAgo(25 * 60) }).eq("id", late.conversationId);
    const f2 = await scheduledFor(late.conversationId);
    expect(await processFollowUp(admin, f2!.id)).toMatchObject({ outcome: "skipped", reason: "window_closed" });

    const late2 = await lead({ productId: null });
    await admin.from("conversations").update({ last_customer_message_at: minsAgo(25 * 60) }).eq("id", late2.conversationId);
    await admin.from("ai_settings").update({ follow_up_template_name: "cart_reminder" }).eq("business_id", BIZ);
    try {
      const f3 = await scheduledFor(late2.conversationId);
      expect(await processFollowUp(admin, f3!.id)).toMatchObject({ outcome: "sent", channel: "template" });
      expect(await lastOutbound(late2.conversationId)).toMatchObject({ type: "template", body: "[template: cart_reminder]", sender: "automation" });
    } finally {
      await admin.from("ai_settings").update({ follow_up_template_name: null }).eq("business_id", BIZ);
    }
  });

  it("stops for handoff and purchase", async () => {
    const human = await lead();
    const f1 = await scheduledFor(human.conversationId);
    await admin.from("conversations").update({ ai_mode: "HUMAN_ACTIVE" }).eq("id", human.conversationId);
    expect(await processFollowUp(admin, f1!.id)).toMatchObject({ outcome: "cancelled", reason: "human_handling" });

    const bought = await lead();
    const f2 = await scheduledFor(bought.conversationId);
    await admin.from("conversations").update({ sales_outcome: "purchased" }).eq("id", bought.conversationId);
    const r = await scheduleFollowUps(admin);
    expect(r.cancelled).toBeGreaterThanOrEqual(1);
    const { data: row } = await admin.from("follow_ups").select("status, cancel_reason").eq("id", f2!.id).single();
    expect(row).toMatchObject({ status: "cancelled", cancel_reason: "purchased" });
  });

  it("STOP opts the customer out (cancelling follow-ups) and START opts back in, via WhatsApp", async () => {
    const l = await lead();
    const fu = await scheduledFor(l.conversationId);
    expect(fu).toBeTruthy();

    await customerSays(l.waId, "STOP");
    const out = await waitFor(async () => {
      const { data } = await admin.from("customers").select("opted_out_at").eq("id", l.customerId).single();
      return data?.opted_out_at;
    });
    expect(out).toBeTruthy();
    const { data: cancelled } = await admin.from("follow_ups").select("status, cancel_reason").eq("id", fu!.id).single();
    expect(cancelled).toMatchObject({ status: "cancelled", cancel_reason: "opted_out" });
    const confirm = await waitFor(async () => {
      const m = await lastOutbound(l.conversationId);
      return m?.sender === "system" && m.status !== "queued" ? m : null;
    });
    expect(confirm).toMatchObject({ status: "sent" });
    expect(confirm.body).toContain("You won't receive automated messages");
    expect(await scheduledFor(l.conversationId)).toBeNull();

    await customerSays(l.waId, "start");
    await waitFor(async () => {
      const { data } = await admin.from("customers").select("opted_out_at").eq("id", l.customerId).single();
      return data && data.opted_out_at === null;
    });
    const back = await waitFor(async () => {
      const m = await lastOutbound(l.conversationId);
      return m?.body?.startsWith("You're subscribed") && m.status !== "queued" ? m : null;
    });
    expect(back.status).toBe("sent");
  });

  it("the sweeper re-queues stuck and failed WhatsApp events", async () => {
    const key = `test:sweeper:${randomBytes(6).toString("hex")}`;
    const { data: ev } = await admin
      .from("whatsapp_events")
      .insert({
        event_key: key,
        business_id: BIZ,
        whatsapp_account_id: account.id,
        phone_number_id: account.phone_number_id,
        event_type: "status",
        payload: { kind: "status", waMessageId: "wamid.none", status: "delivered", time: new Date().toISOString() },
        status: "processing",
        received_at: minsAgo(20),
      })
      .select("id")
      .single();
    createdEvents.push(ev!.id);
    const found = await findEventsToRetry(admin);
    expect(found.map((e) => e.id)).toContain(ev!.id);
    const { data: row } = await admin.from("whatsapp_events").select("status, error").eq("id", ev!.id).single();
    expect(row).toMatchObject({ status: "failed", error: "processing timed out" });
  });
});
