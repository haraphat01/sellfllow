#!/usr/bin/env node
// Local stand-in for the Paystack API, for development/E2E only. Point the app
// at it with PAYSTACK_BASE_URL=http://127.0.0.1:8298 (ignored in production).
//   node scripts/mock-paystack.mjs [port]
// Test controls:  POST /__pay/<ref> {"amount"?, "currency"?, "channel"?}  → transaction becomes "success"
//                 GET  /__subaccount/<code>                    → inspect a subaccount
//                 GET  /__tx/<ref>                             → inspect
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8298);
const txs = new Map();
const subaccounts = new Map();
let nextId = 5_000_000;

const BANKS = [
  { name: "Access Bank", code: "044", active: true, currency: "NGN", type: "nuban" },
  { name: "Guaranty Trust Bank", code: "058", active: true, currency: "NGN", type: "nuban" },
  { name: "Opay", code: "999992", active: true, currency: "NGN", type: "nuban" },
  { name: "Zenith Bank", code: "057", active: true, currency: "NGN", type: "nuban" },
  { name: "Old Closed Bank", code: "000", active: false, currency: "NGN", type: "nuban" },
];

// Card payments are reusable (can be charged again); bank transfers are not.
const authorizationFor = (channel, code) =>
  channel === "card"
    ? { authorization_code: code, reusable: true, last4: "4081", exp_month: "12", exp_year: "2030", card_type: "visa", brand: "visa", channel: "card" }
    : { authorization_code: code, reusable: false, channel };

createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const url = new URL(req.url, "http://x");
  const json = (status, data) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };
  console.log(new Date().toISOString(), req.method, url.pathname);

  if (url.pathname.startsWith("/__pay/") && req.method === "POST") {
    const ref = decodeURIComponent(url.pathname.slice(7));
    const tx = txs.get(ref);
    if (!tx) return json(404, { status: false, message: "no such tx" });
    const o = body ? JSON.parse(body) : {};
    const channel = o.channel ?? "card";
    Object.assign(tx, {
      status: "success",
      paid_at: new Date().toISOString(),
      channel,
      gateway_response: "Successful",
      authorization: authorizationFor(channel, o.authorizationCode ?? `AUTH_${ref.replace(/\W/g, "")}`),
      ...(o.amount ? { amount: o.amount } : {}),
      ...(o.currency ? { currency: o.currency } : {}),
    });
    return json(200, { status: true, data: tx });
  }
  if (url.pathname.startsWith("/__subaccount/")) return json(200, subaccounts.get(decodeURIComponent(url.pathname.slice(14))) ?? null);
  if (url.pathname.startsWith("/__tx/")) return json(200, txs.get(decodeURIComponent(url.pathname.slice(6))) ?? null);

  const auth = req.headers.authorization ?? "";
  if (!/^Bearer sk_(test|live)_\w+/.test(auth)) return json(401, { status: false, message: "Invalid key" });

  if (url.pathname === "/balance") return json(200, { status: true, message: "Balances retrieved", data: [{ currency: "NGN", balance: 0 }] });

  if (url.pathname === "/transaction/initialize" && req.method === "POST") {
    const p = JSON.parse(body || "{}");
    if (!p.email || !p.amount || !p.reference) return json(400, { status: false, message: "email, amount and reference are required" });
    if (txs.has(p.reference)) return json(400, { status: false, message: "Duplicate Transaction Reference", code: "duplicate_reference" });
    if (p.subaccount && !subaccounts.has(p.subaccount)) return json(400, { status: false, message: "Invalid subaccount code" });
    if (p.transaction_charge !== undefined && Number(p.transaction_charge) >= Number(p.amount)) return json(400, { status: false, message: "Transaction charge must be less than the amount" });
    txs.set(p.reference, {
      id: nextId++,
      status: "abandoned",
      reference: p.reference,
      amount: Number(p.amount),
      currency: p.currency ?? "NGN",
      paid_at: null,
      channel: "card",
      gateway_response: "The transaction was not completed",
      metadata: p.metadata ?? {},
      ...(p.subaccount ? { subaccount: { subaccount_code: p.subaccount }, split: { transaction_charge: Number(p.transaction_charge ?? 0), bearer: p.bearer ?? "account" } } : {}),
    });
    return json(200, { status: true, message: "Authorization URL created", data: { authorization_url: `http://127.0.0.1:${port}/checkout/${p.reference}`, access_code: `ac_${p.reference}`, reference: p.reference } });
  }
  if (url.pathname.startsWith("/transaction/verify/")) {
    const tx = txs.get(decodeURIComponent(url.pathname.slice(20)));
    if (!tx) return json(400, { status: false, message: "Transaction reference not found", code: "transaction_not_found" });
    return json(200, { status: true, message: "Verification successful", data: tx });
  }
  // Saved-card charge. An authorization code containing "DECLINE" fails like an insufficient-funds card.
  if (url.pathname === "/transaction/charge_authorization" && req.method === "POST") {
    const p = JSON.parse(body || "{}");
    if (!p.authorization_code || !p.email || !p.amount || !p.reference) return json(400, { status: false, message: "authorization_code, email, amount and reference are required" });
    if (txs.has(p.reference)) return json(400, { status: false, message: "Duplicate Transaction Reference", code: "duplicate_reference" });
    const declined = String(p.authorization_code).includes("DECLINE");
    const tx = {
      id: nextId++,
      status: declined ? "failed" : "success",
      reference: p.reference,
      amount: Number(p.amount),
      currency: p.currency ?? "NGN",
      paid_at: declined ? null : new Date().toISOString(),
      channel: "card",
      gateway_response: declined ? "Insufficient Funds" : "Approved",
      metadata: p.metadata ?? {},
      authorization: authorizationFor("card", p.authorization_code),
    };
    txs.set(p.reference, tx);
    return json(200, { status: true, message: declined ? "Charge attempted" : "Charge attempted", data: tx });
  }
  // Banks, account lookup and subaccounts (bank-account payouts).
  if (url.pathname === "/bank") return json(200, { status: true, message: "Banks retrieved", data: BANKS });
  if (url.pathname === "/bank/resolve") {
    const acct = url.searchParams.get("account_number") ?? "";
    const bank = BANKS.find((b) => b.code === url.searchParams.get("bank_code"));
    if (!bank || !/^[0-9]{10}$/.test(acct) || acct === "0000000000") return json(422, { status: false, message: "Could not resolve account name. Check parameters or try again." });
    return json(200, { status: true, message: "Account number resolved", data: { account_number: acct, account_name: `MOCK HOLDER ${acct.slice(-4)}` } });
  }
  if (url.pathname === "/subaccount" && req.method === "POST") {
    const p = JSON.parse(body || "{}");
    if (!p.business_name || !p.settlement_bank || !p.account_number || p.percentage_charge === undefined) return json(400, { status: false, message: "business_name, settlement_bank, account_number and percentage_charge are required" });
    const code = `ACCT_mock${nextId++}`;
    subaccounts.set(code, { subaccount_code: code, ...p, active: true });
    return json(201, { status: true, message: "Subaccount created", data: subaccounts.get(code) });
  }
  if (url.pathname.startsWith("/subaccount/") && req.method === "PUT") {
    const code = decodeURIComponent(url.pathname.slice(12));
    const sub = subaccounts.get(code);
    if (!sub) return json(404, { status: false, message: "Subaccount not found" });
    Object.assign(sub, JSON.parse(body || "{}"));
    return json(200, { status: true, message: "Subaccount updated", data: sub });
  }

  if (url.pathname === "/refund" && req.method === "POST") {
    const p = JSON.parse(body || "{}");
    const tx = txs.get(p.transaction);
    if (!tx || tx.status !== "success") return json(400, { status: false, message: "Transaction has not been completed" });
    return json(200, { status: true, message: "Refund has been queued for processing", data: { status: "pending", transaction: { reference: tx.reference } } });
  }
  json(404, { status: false, message: `mock: no route for ${req.method} ${url.pathname}` });
}).listen(port, "127.0.0.1", () => console.log(`mock Paystack API on http://127.0.0.1:${port}`));
