#!/usr/bin/env node
// Local stand-in for Meta's Graph API, for development/E2E only. Point the app
// at it with META_GRAPH_BASE_URL=http://127.0.0.1:8299 (ignored in production).
//   node scripts/mock-graph.mjs [port]
// Messages whose text contains "[fail]" are rejected like Meta would.
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8299);
const sent = [];

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
    return json(200, { id: path.slice(1), display_phone_number: "+1 555 010 0000", verified_name: "Mock Business", quality_rating: "GREEN" });
  }
  if (/^\/\d+\/(subscribed_apps|register)$/.test(path)) return json(200, { success: true });
  json(404, { error: { message: `mock: no route for ${req.method} ${path}` } });
}).listen(port, "127.0.0.1", () => console.log(`mock Graph API on http://127.0.0.1:${port}`));
