#!/usr/bin/env node
// Local stand-in for Meta's Graph API, for development/E2E only. Point the app
// at it with META_GRAPH_BASE_URL=http://127.0.0.1:8299 (ignored in production).
//   node scripts/mock-graph.mjs [port]
// Messages whose text contains "[fail]" are rejected like Meta would.
// Phone numbers start registered (Cloud API) with no PIN, unless changed:
//   POST /__number/<id> {"registered": bool, "pin": "123456"|null, "slowMs": n}
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8299);
const sent = [];
// Per-number registration state (defaults: registered on Cloud API, no PIN).
const numbers = new Map();
const numberState = (id) => {
  if (!numbers.has(id)) numbers.set(id, { registered: true, pin: null, slowMs: 0 });
  return numbers.get(id);
};

createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const json = (status, data) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };
  const auth = req.headers.authorization ?? "";
  const path = new URL(req.url, "http://x").pathname.replace(/^\/v\d+\.\d+/, "");
  console.log(new Date().toISOString(), req.method, path, auth ? "(auth)" : "(no auth)");

  const ctl = path.match(/^\/__number\/(\d+)$/);
  if (ctl && req.method === "POST") {
    Object.assign(numberState(ctl[1]), JSON.parse(body || "{}"));
    return json(200, numberState(ctl[1]));
  }
  if (ctl) return json(200, numberState(ctl[1]));

  if (!auth.startsWith("Bearer ")) return json(401, { error: { message: "Missing token", code: 190 } });
  if (req.method === "GET" && path === "/__sent") return json(200, sent);

  const m = path.match(/^\/(\d+)\/messages$/);
  if (req.method === "POST" && m) {
    const payload = JSON.parse(body || "{}");
    if (payload.status === "read") return json(200, { success: true });
    if (JSON.stringify(payload).includes("[fail]")) {
      return json(400, { error: { message: "(#131026) Message undeliverable", code: 131026, fbtrace_id: "mock" } });
    }
    const id = `wamid.MOCK.${randomBytes(8).toString("hex")}`;
    sent.push({ id, to: payload.to, type: payload.type, text: payload.text?.body, template: payload.template?.name });
    return json(200, { messaging_product: "whatsapp", contacts: [{ input: payload.to, wa_id: payload.to }], messages: [{ id }] });
  }
  if (req.method === "GET" && /^\/\d+$/.test(path)) {
    const n = numberState(path.slice(1));
    return json(200, {
      id: path.slice(1),
      display_phone_number: "+1 555 010 0000",
      verified_name: "Mock Business",
      quality_rating: "GREEN",
      status: n.registered ? "CONNECTED" : "PENDING",
      platform_type: n.registered ? "CLOUD_API" : "NOT_APPLICABLE",
      code_verification_status: "VERIFIED",
    });
  }
  // Set the two-step verification PIN (only for registered numbers).
  if (req.method === "POST" && /^\/\d+$/.test(path)) {
    const n = numberState(path.slice(1));
    const p = JSON.parse(body || "{}");
    if (!n.registered) return json(400, { error: { message: "(#100) Number is not registered", code: 100 } });
    if (p.pin) n.pin = String(p.pin);
    return json(200, { success: true });
  }
  const reg = path.match(/^\/(\d+)\/register$/);
  if (reg && req.method === "POST") {
    const n = numberState(reg[1]);
    const p = JSON.parse(body || "{}");
    if (n.slowMs) await new Promise((r) => setTimeout(r, n.slowMs));
    if (n.pin && n.pin !== String(p.pin)) return json(400, { error: { message: "(#133005) Two step verification PIN Mismatch", code: 133005 } });
    Object.assign(n, { registered: true, pin: String(p.pin) });
    return json(200, { success: true });
  }
  if (/^\/\d+\/subscribed_apps$/.test(path)) return json(200, { success: true });
  json(404, { error: { message: `mock: no route for ${req.method} ${path}` } });
}).listen(port, "127.0.0.1", () => console.log(`mock Graph API on http://127.0.0.1:${port}`));
