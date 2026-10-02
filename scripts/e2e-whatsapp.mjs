#!/usr/bin/env node
// End-to-end test of the WhatsApp webhook pipeline against a running app
// (dev server + Inngest dev server) and a real Supabase project. Uses a fake
// phone_number_id attached to an existing test business; nothing is sent to Meta.
//
//   node --env-file=.env --env-file=<e2e.env> scripts/e2e-whatsapp.mjs <business_id>
import { createHmac, randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const APP = process.env.E2E_APP_URL ?? "http://localhost:3000";
const businessId = process.argv[2];
if (!businessId) throw new Error("usage: e2e-whatsapp.mjs <business_id>");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const secret = process.env.META_APP_SECRET;
const verifyToken = process.env.META_VERIFY_TOKEN;

const suffix = String(Date.now()).slice(-9);
const PHONE_ID = `9900${suffix}`;
const WABA_ID = `8800${suffix}`;
const CUSTOMER = `23480${suffix.slice(-8)}`;
let failures = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `  — ${detail}`}`);
  if (!ok) failures++;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function messagePayload({ id, body, phoneId = PHONE_ID, from = CUSTOMER, ts = Math.floor(Date.now() / 1000) }) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: WABA_ID, changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "15550000000", phone_number_id: phoneId },
      contacts: [{ profile: { name: "E2E Sarah" }, wa_id: from }],
      messages: [{ from, id, timestamp: String(ts), type: "text", text: { body } }],
    } }] }],
  };
}

function statusPayload({ id, status, ts }) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: WABA_ID, changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "15550000000", phone_number_id: PHONE_ID },
      statuses: [{ id, status, timestamp: String(ts), recipient_id: CUSTOMER }],
    } }] }],
  };
}

async function post(payload, { sign = true, badSig = false } = {}) {
  const raw = JSON.stringify(payload);
  const headers = { "content-type": "application/json" };
  if (sign) headers["x-hub-signature-256"] = `sha256=${createHmac("sha256", badSig ? "wrong" : secret).update(raw).digest("hex")}`;
  const res = await fetch(`${APP}/api/webhooks/whatsapp`, { method: "POST", headers, body: raw });
  return res.status;
}

async function waitForEvents(keys, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await admin.from("whatsapp_events").select("event_key, status").in("event_key", keys);
    if (data?.length === keys.length && data.every((e) => ["processed", "ignored"].includes(e.status))) return data;
    await sleep(500);
  }
  const { data } = await admin.from("whatsapp_events").select("event_key, status, error").in("event_key", keys);
  return data;
}

// ---------------------------------------------------------------------------
const { data: account, error: accErr } = await admin
  .from("whatsapp_accounts")
  .insert({ business_id: businessId, waba_id: WABA_ID, phone_number_id: PHONE_ID, display_phone_number: "+1 555 000 0000", status: "connected" })
  .select("id")
  .single();
if (accErr) throw accErr;
console.log(`test number ${PHONE_ID} → business ${businessId}\n`);

try {
  // Verification handshake
  const ok = await fetch(`${APP}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=12345`);
  check("GET verify with correct token echoes challenge", ok.status === 200 && (await ok.text()) === "12345");
  const bad = await fetch(`${APP}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345`);
  check("GET verify with wrong token is rejected", bad.status === 403, `status ${bad.status}`);

  // Signature enforcement
  const m1 = `wamid.E2E.${randomBytes(6).toString("hex")}`;
  check("unsigned POST rejected", (await post(messagePayload({ id: m1, body: "x" }), { sign: false })) === 401);
  check("wrongly signed POST rejected", (await post(messagePayload({ id: m1, body: "x" }), { badSig: true })) === 401);
  const { count: forged } = await admin.from("whatsapp_events").select("id", { count: "exact", head: true }).eq("event_key", `msg:${m1}`);
  check("rejected POSTs stored nothing", forged === 0);

  // Inbound message → routed, stored, processed
  const t0 = Math.floor(Date.now() / 1000);
  check("signed message accepted", (await post(messagePayload({ id: m1, body: "Hi, how much is the black bag?", ts: t0 }))) === 200);
  const ev = await waitForEvents([`msg:${m1}`]);
  check("event processed by background job", ev?.[0]?.status === "processed", JSON.stringify(ev));

  const { data: customer } = await admin.from("customers").select("id, wa_id, phone, profile_name, business_id").eq("business_id", businessId).eq("wa_id", CUSTOMER).maybeSingle();
  check("customer created in the right business", customer?.business_id === businessId && customer.phone === `+${CUSTOMER}` && customer.profile_name === "E2E Sarah", JSON.stringify(customer));

  const { data: conv } = await admin.from("conversations").select("id, unread_count, last_message_preview, last_customer_message_at, whatsapp_account_id").eq("customer_id", customer?.id).eq("status", "open").maybeSingle();
  check("open conversation on this number", conv?.whatsapp_account_id === account.id, JSON.stringify(conv));
  check("conversation preview + 24h window timestamp", conv?.last_message_preview === "Hi, how much is the black bag?" && Boolean(conv?.last_customer_message_at));

  // Duplicate delivery (Meta retries)
  check("duplicate delivery accepted (200)", (await post(messagePayload({ id: m1, body: "Hi, how much is the black bag?", ts: t0 }))) === 200);
  await sleep(2500);
  const { count: msgCount } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("wa_message_id", m1);
  const { count: evCount } = await admin.from("whatsapp_events").select("id", { count: "exact", head: true }).eq("event_key", `msg:${m1}`);
  check("duplicate did not create a second message or event", msgCount === 1 && evCount === 1, `messages=${msgCount} events=${evCount}`);

  // Burst from the same customer: all stored, counted in order
  const burst = Array.from({ length: 5 }, (_, i) => ({ id: `wamid.E2E.burst.${suffix}.${i}`, body: `burst ${i}`, ts: t0 + 1 + i }));
  await Promise.all(burst.map((b) => post(messagePayload(b))));
  await waitForEvents(burst.map((b) => `msg:${b.id}`));
  const { data: conv2 } = await admin.from("conversations").select("unread_count, last_message_preview").eq("id", conv.id).single();
  check("burst of 5 stored with correct unread count", conv2.unread_count === 6, `unread=${conv2.unread_count}`);
  check("latest message is the preview", conv2.last_message_preview === "burst 4", conv2.last_message_preview);

  // Outbound status updates, delivered out of order
  const out = `wamid.E2E.OUT.${suffix}`;
  await admin.from("messages").insert({ business_id: businessId, conversation_id: conv.id, direction: "outbound", sender: "staff", body: "Yes it's ₦45,000", wa_message_id: out, status: "sent" });
  await post(statusPayload({ id: out, status: "read", ts: t0 + 20 }));
  await waitForEvents([`status:${out}:read`]);
  await post(statusPayload({ id: out, status: "delivered", ts: t0 + 10 }));
  await waitForEvents([`status:${out}:delivered`]);
  const { data: outMsg } = await admin.from("messages").select("status").eq("wa_message_id", out).single();
  check("out-of-order statuses never regress (read stays read)", outMsg.status === "read", outMsg.status);

  // Unknown number: stored for audit, ignored, no tenant data created
  const stray = `wamid.E2E.stray.${suffix}`;
  check("message for unknown number returns 200", (await post(messagePayload({ id: stray, body: "hello?", phoneId: "1234567890123" }))) === 200);
  const { data: strayEv } = await admin.from("whatsapp_events").select("status, business_id").eq("event_key", `msg:${stray}`).single();
  check("unknown number event is ignored with no business", strayEv.status === "ignored" && strayEv.business_id === null, JSON.stringify(strayEv));
  const { count: strayMsgs } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("wa_message_id", stray);
  check("unknown number created no message", strayMsgs === 0);
} finally {
  // Clean up the fake number and everything created through it.
  const { data: convs } = await admin.from("conversations").select("id, customer_id").eq("whatsapp_account_id", account.id);
  await admin.from("conversations").delete().eq("whatsapp_account_id", account.id);
  if (convs?.length) await admin.from("customers").delete().in("id", convs.map((c) => c.customer_id));
  await admin.from("whatsapp_events").delete().like("event_key", `%E2E%${""}`).in("phone_number_id", [PHONE_ID, "1234567890123"]);
  await admin.from("whatsapp_accounts").delete().eq("id", account.id);
  console.log(`\n${failures ? `${failures} FAILED` : "ALL WHATSAPP E2E CHECKS PASSED"} (test data cleaned up)`);
  process.exitCode = failures ? 1 : 0;
}
