#!/usr/bin/env node
// Seeds a test business's inbox through the real webhook pipeline: attaches a
// fake WhatsApp number (with an encrypted fake token, for use with
// scripts/mock-graph.mjs) and delivers signed messages from a few customers.
//   node --env-file=.env [--env-file=e2e.env] scripts/e2e-seed-inbox.mjs seed <business_id>
//   node --env-file=.env scripts/e2e-seed-inbox.mjs message <business_id> <from_wa_id> "<text>"
//   node --env-file=.env scripts/e2e-seed-inbox.mjs status <business_id> <wamid> <sent|delivered|read|failed>
//   node --env-file=.env scripts/e2e-seed-inbox.mjs cleanup <business_id>
import { createCipheriv, createHmac, randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const [cmd, businessId, ...rest] = process.argv.slice(2);
if (!cmd || !businessId) throw new Error("usage: seed|message|status|cleanup <business_id> ...");

const APP = process.env.E2E_APP_URL ?? "http://localhost:3000";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const WABA = "7700000000001";
const phoneIdFor = (b) => `77${parseInt(b.replace(/-/g, "").slice(0, 10), 16).toString().slice(0, 11)}`;
const PHONE_ID = phoneIdFor(businessId);

function encrypt(plaintext, aad) {
  const key = Buffer.from(process.env.CREDENTIALS_ENCRYPTION_KEY, "base64");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad));
  const enc = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

async function deliver(value) {
  const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: WABA, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "15550100000", phone_number_id: PHONE_ID }, ...value } }] }] });
  const sig = `sha256=${createHmac("sha256", process.env.META_APP_SECRET).update(raw).digest("hex")}`;
  const res = await fetch(`${APP}/api/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body: raw });
  if (res.status !== 200) throw new Error(`webhook returned ${res.status}`);
}

const message = (from, name, text, ts = Math.floor(Date.now() / 1000)) =>
  deliver({ contacts: [{ wa_id: from, profile: { name } }], messages: [{ from, id: `wamid.SEED.${randomBytes(8).toString("hex")}`, timestamp: String(ts), type: "text", text: { body: text } }] });

if (cmd === "seed") {
  const { data: cred, error: credErr } = await admin
    .from("business_credentials")
    .upsert({ business_id: businessId, provider: "whatsapp", label: `token:${PHONE_ID}`, ciphertext: encrypt("EAAMOCK-local-test-token", businessId), last_four: "oken" }, { onConflict: "business_id,provider,label" })
    .select("id")
    .single();
  if (credErr) throw credErr;
  const { error } = await admin.from("whatsapp_accounts").upsert(
    { business_id: businessId, waba_id: WABA, phone_number_id: PHONE_ID, display_phone_number: "+1 555 010 0000", verified_name: "Mock Business", status: "connected", credential_id: cred.id, connected_at: new Date().toISOString() },
    { onConflict: "phone_number_id" },
  );
  if (error) throw error;

  const now = Math.floor(Date.now() / 1000);
  await message("2348031110001", "Sarah Okafor", "Hi, how much is the black bag?", now - 600);
  await message("2348031110002", "David Mensah", "Do you deliver to Ibadan?", now - 300);
  await message("2348031110003", "Mary Eze", "I want to speak to a person please", now - 120);
  await message("2348031110001", "Sarah Okafor", "Is it available in large?", now - 60);
  console.log(`seeded inbox for ${businessId} via number ${PHONE_ID}`);
} else if (cmd === "message") {
  const [from, text] = rest;
  await message(from, "", text);
  console.log("delivered");
} else if (cmd === "status") {
  const [wamid, status] = rest;
  await deliver({ statuses: [{ id: wamid, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: "0" }] });
  console.log("delivered status");
} else if (cmd === "cleanup") {
  const { data: acc } = await admin.from("whatsapp_accounts").select("id").eq("phone_number_id", PHONE_ID).maybeSingle();
  if (acc) {
    const { data: convs } = await admin.from("conversations").select("customer_id").eq("whatsapp_account_id", acc.id);
    await admin.from("conversations").delete().eq("whatsapp_account_id", acc.id);
    if (convs?.length) await admin.from("customers").delete().in("id", convs.map((c) => c.customer_id));
    await admin.from("whatsapp_accounts").delete().eq("id", acc.id);
  }
  await admin.from("business_credentials").delete().eq("business_id", businessId).eq("label", `token:${PHONE_ID}`);
  await admin.from("whatsapp_events").delete().eq("phone_number_id", PHONE_ID);
  console.log("cleaned up");
}
