/**
 * Integration: bank-account payouts (Paystack subaccounts) against a real
 * Supabase project. Starts its own mock Paystack (scripts/mock-paystack.mjs)
 * on a private port and points the platform key at it for this file only.
 *
 *   RUN_INTEGRATION=1 E2E_BUSINESS_ID=<id> npm run test:integration
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = Boolean(process.env.RUN_INTEGRATION && process.env.E2E_BUSINESS_ID && process.env.CREDENTIALS_ENCRYPTION_KEY);
const BIZ = process.env.E2E_BUSINESS_ID ?? "";
const PORT = 8398;
const MOCK = `http://127.0.0.1:${PORT}`;
const PLATFORM_KEY = `sk_test_platform${randomBytes(12).toString("hex")}`;

describe.skipIf(!run)("Bank-account payouts (integration)", { timeout: 90_000 }, async () => {
  // Env is read once (serverEnv caches), so set it before importing app modules.
  const savedEnv = { base: process.env.PAYSTACK_BASE_URL, key: process.env.PAYSTACK_SECRET_KEY };
  process.env.PAYSTACK_BASE_URL = MOCK;
  process.env.PAYSTACK_SECRET_KEY = PLATFORM_KEY;

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { signPaystackPayload } = await import("@/lib/paystack/signature");
  const payouts = await import("@/services/payments/payouts.service");
  const payments = await import("@/services/payments/payments.service");

  const admin = createAdminClient();
  let mock: ChildProcess;
  let ownerId = "";
  let merchantKey: { ciphertext: string; last_four: string | null } | null = null;
  let savedPayout: Record<string, unknown> | null = null;
  let savedCommission: Record<string, unknown> | null = null;
  const createdCustomers: string[] = [];
  const startedAt = new Date().toISOString();

  async function newOrder() {
    const wa = `23493${randomBytes(4).readUInt32BE() % 100000000}`.padEnd(13, "0").slice(0, 13);
    const { data: c } = await admin.from("customers").insert({ business_id: BIZ, wa_id: wa, phone: `+${wa}`, name: "Payout Tester" }).select("id").single();
    createdCustomers.push(c!.id);
    const { data: bag } = await admin.from("products").select("id").eq("business_id", BIZ).eq("sku", "BELT-BRN-32").single();
    const { data: orderId, error } = await admin.rpc("create_order", {
      p_business_id: BIZ,
      p_customer_id: c!.id,
      p_conversation_id: null as unknown as string,
      p_items: [{ product_id: bag!.id, quantity: 1 }],
      p_delivery_zone: "Lagos Mainland",
      p_delivery_address: "5 Akata Alanamu, Ilorin",
      p_customer_name: "Payout Tester",
      p_source: "ai",
      p_ai_assisted: true,
      p_idempotency_key: `payout-${randomBytes(6).toString("hex")}`,
    });
    if (error) throw error;
    return orderId as string;
  }
  const webhook = (reference: string, key: string, id = Date.now()) => {
    const raw = JSON.stringify({ event: "charge.success", data: { id, reference, amount: 1, currency: "NGN", status: "success" } });
    return payments.handlePaystackWebhook(admin, { rawBody: raw, signature: signPaystackPayload(raw, key), requestId: `test-${id}` });
  };

  beforeAll(async () => {
    mock = spawn(process.execPath, ["scripts/mock-paystack.mjs", String(PORT)], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) {
      if (await fetch(`${MOCK}/__tx/none`).then(() => true, () => false)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    // Audit-log actor: the business owner, or any user if the E2E owner account was removed.
    const { data: owner } = await admin.from("business_members").select("user_id").eq("business_id", BIZ).eq("role", "owner").maybeSingle();
    const { data: anyone } = owner ? { data: null } : await admin.from("profiles").select("id").limit(1).single();
    ownerId = owner?.user_id ?? anyone!.id;
    // Start from a clean slate: no payout account, and no legacy merchant key.
    const { data: key } = await admin.from("business_credentials").select("ciphertext, last_four").eq("business_id", BIZ).eq("provider", "paystack").eq("label", "secret").maybeSingle();
    merchantKey = key;
    await admin.from("business_credentials").delete().eq("business_id", BIZ).eq("provider", "paystack").eq("label", "secret");
    const { data: payout } = await admin.from("payout_accounts").select("*").eq("business_id", BIZ).maybeSingle();
    savedPayout = payout;
    await admin.from("payout_accounts").delete().eq("business_id", BIZ);
    const { data: commission } = await admin.from("platform_settings").select("*").eq("key", "payments").maybeSingle();
    savedCommission = commission;
    await admin.from("platform_settings").upsert({ key: "payments", value: { commission_percent: 2, commission_flat_minor: 10_000 } });
  });

  afterAll(async () => {
    const { data: orders } = await admin.from("orders").select("id, status").in("customer_id", createdCustomers);
    for (const o of orders ?? []) if (o.status === "pending_payment") await admin.rpc("cancel_order", { p_business_id: BIZ, p_order_id: o.id, p_reason: "test cleanup" });
    const paid = (orders ?? []).filter((o) => o.status !== "pending_payment" && o.status !== "cancelled").length;
    if (paid) {
      const { data: p } = await admin.from("products").select("id, stock_quantity").eq("business_id", BIZ).eq("sku", "BELT-BRN-32").single();
      await admin.from("products").update({ stock_quantity: p!.stock_quantity + paid }).eq("id", p!.id);
    }
    await admin.from("orders").delete().in("customer_id", createdCustomers);
    await admin.from("customers").delete().in("id", createdCustomers);
    await admin.from("payout_accounts").delete().eq("business_id", BIZ);
    if (savedPayout) await admin.from("payout_accounts").insert(savedPayout as never);
    if (merchantKey) await admin.from("business_credentials").upsert({ business_id: BIZ, provider: "paystack", label: "secret", ...merchantKey }, { onConflict: "business_id,provider,label" });
    if (savedCommission) await admin.from("platform_settings").upsert(savedCommission as never);
    else await admin.from("platform_settings").delete().eq("key", "payments");
    await admin.from("notifications").delete().eq("business_id", BIZ).like("type", "payouts.%").gte("created_at", startedAt);
    mock?.kill();
    process.env.PAYSTACK_BASE_URL = savedEnv.base;
    process.env.PAYSTACK_SECRET_KEY = savedEnv.key;
  });

  it("looks up bank accounts with Paystack", async () => {
    const banks = await payouts.listBanks();
    expect(banks.map((b) => b.code)).toContain("058");
    expect(banks.map((b) => b.code)).not.toContain("000"); // inactive banks hidden
    expect(await payouts.verifyBankAccount({ bankCode: "058", accountNumber: "0123456789" })).toEqual({ accountName: "MOCK HOLDER 6789", bankName: "Guaranty Trust Bank" });
    await expect(payouts.verifyBankAccount({ bankCode: "058", accountNumber: "0000000000" })).rejects.toThrow(/couldn't find that account/);
    await expect(payouts.verifyBankAccount({ bankCode: "999", accountNumber: "0123456789" })).rejects.toThrow(/Choose your bank/);
    await expect(payouts.verifyBankAccount({ bankCode: "058", accountNumber: "12345" })).rejects.toThrow(/10-digit/);
  });

  it("creates a subaccount for the bank account and enables payments", async () => {
    expect(await payments.canCollectPayments(admin, BIZ)).toBe(false);
    const res = await payouts.connectPayoutAccount(admin, { businessId: BIZ, bankCode: "058", accountNumber: "0123456789", userId: ownerId, userEmail: "owner@example.com" });
    expect(res).toEqual({ bankName: "Guaranty Trust Bank", accountName: "MOCK HOLDER 6789", last4: "6789" });
    const row = await payouts.getPayoutAccount(admin, BIZ);
    expect(row).toMatchObject({ bank_code: "058", account_number_last4: "6789", account_name: "MOCK HOLDER 6789", status: "active" });
    const sub = await fetch(`${MOCK}/__subaccount/${row!.subaccount_code}`).then((r) => r.json());
    expect(sub).toMatchObject({ settlement_bank: "058", account_number: "0123456789", percentage_charge: 0 });
    expect(await payments.canCollectPayments(admin, BIZ)).toBe(true);
    // The full account number is never stored.
    expect(JSON.stringify(row)).not.toContain("0123456789");
  });

  it("splits payment links to the subaccount with SellFlow's fee, and confirms them with the platform key", async () => {
    const orderId = await newOrder();
    const link = await payments.createPaymentLink(admin, { businessId: BIZ, orderId });
    const { data: pay } = await admin.from("payments").select("id, collection_mode, subaccount_code, platform_fee_minor, amount_minor").eq("reference", link.reference).single();
    const expectedFee = Math.round(pay!.amount_minor * 0.02) + 10_000;
    expect(pay).toMatchObject({ collection_mode: "platform_subaccount", platform_fee_minor: expectedFee });
    const tx = await fetch(`${MOCK}/__tx/${encodeURIComponent(link.reference)}`).then((r) => r.json());
    expect(tx.subaccount.subaccount_code).toBe(pay!.subaccount_code);
    expect(tx.split).toEqual({ transaction_charge: expectedFee, bearer: "subaccount" });

    // Signed with anything but the platform key: rejected. Signed correctly but unpaid: not paid.
    expect((await webhook(link.reference, `sk_test_${randomBytes(16).toString("hex")}`)).status).toBe(401);
    expect((await webhook(link.reference, PLATFORM_KEY)).handled).toBe("not_paid");

    await fetch(`${MOCK}/__pay/${encodeURIComponent(link.reference)}`, { method: "POST" });
    const res = await webhook(link.reference, PLATFORM_KEY);
    expect(res).toMatchObject({ status: 200, handled: "paid", paid: { businessId: BIZ, orderId } });
    const { data: order } = await admin.from("orders").select("status").eq("id", orderId).single();
    expect(order!.status).toBe("paid");

    // Refunds go through the platform account too.
    await payments.requestRefund(admin, { businessId: BIZ, orderId, userId: ownerId });
    const { data: refunded } = await admin.from("payments").select("refund_requested_at").eq("id", pay!.id).single();
    expect(refunded!.refund_requested_at).toBeTruthy();
  });

  it("routes subscription references from either webhook URL to billing", async () => {
    const res = await webhook(`sfb-${randomBytes(6).toString("hex")}`, PLATFORM_KEY);
    expect(res.handled.startsWith("billing:")).toBe(true);
  });

  it("changing the account keeps the subaccount, audits and notifies; turning off stops links", async () => {
    const before = await payouts.getPayoutAccount(admin, BIZ);
    await payouts.connectPayoutAccount(admin, { businessId: BIZ, bankCode: "044", accountNumber: "9876543210", userId: ownerId });
    const after = await payouts.getPayoutAccount(admin, BIZ);
    expect(after).toMatchObject({ subaccount_code: before!.subaccount_code, bank_code: "044", account_number_last4: "3210" });
    const { data: log } = await admin.from("audit_logs").select("metadata").eq("business_id", BIZ).eq("action", "payouts.account_changed").order("created_at", { ascending: false }).limit(1).single();
    expect(log!.metadata).toMatchObject({ last4: "3210", previous: { last4: "6789" } });
    const { count } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("business_id", BIZ).eq("type", "payouts.account_changed").gte("created_at", startedAt);
    expect(count).toBe(2);

    await payouts.disablePayoutAccount(admin, { businessId: BIZ, userId: ownerId });
    const sub = await fetch(`${MOCK}/__subaccount/${before!.subaccount_code}`).then((r) => r.json());
    expect(sub.active).toBe(false);
    expect(await payments.canCollectPayments(admin, BIZ)).toBe(false);
    await expect(payments.createPaymentLink(admin, { businessId: BIZ, orderId: await newOrder() })).rejects.toThrow(/can't take online payments/);
  });

  it("an old merchant Paystack key no longer creates links, but payments made with it still verify", async () => {
    // (The E2E business still has its pre-removal key stored; it must be ignored for new links.)
    await payouts.connectPayoutAccount(admin, { businessId: BIZ, bankCode: "058", accountNumber: "0123456789", userId: ownerId });
    const legacyKey = `sk_test_legacy${randomBytes(12).toString("hex")}`;
    const { encryptSecret } = await import("@/lib/security/crypto");
    await admin.from("business_credentials").upsert({ business_id: BIZ, provider: "paystack", label: "secret", ciphertext: encryptSecret(legacyKey, BIZ), last_four: legacyKey.slice(-4) }, { onConflict: "business_id,provider,label" });

    const orderId = await newOrder();
    const link = await payments.createPaymentLink(admin, { businessId: BIZ, orderId });
    const { data: pay } = await admin.from("payments").select("collection_mode, subaccount_code").eq("reference", link.reference).single();
    expect(pay!.collection_mode).toBe("platform_subaccount");

    // A legacy merchant-key payment (created before the change) is still verified with that key.
    const legacyRef = `sf-legacy-${randomBytes(5).toString("hex")}`;
    const { data: legacy } = await admin
      .from("payments")
      .insert({ business_id: BIZ, order_id: await newOrder(), reference: legacyRef, amount_minor: 1_550_000, currency: "NGN", collection_mode: "merchant_key" })
      .select("id")
      .single();
    await fetch(`${MOCK}/transaction/initialize`, {
      method: "POST",
      headers: { authorization: `Bearer ${legacyKey}`, "content-type": "application/json" },
      body: JSON.stringify({ email: "x@example.com", amount: 1_550_000, reference: legacyRef }),
    });
    await fetch(`${MOCK}/__pay/${legacyRef}`, { method: "POST" });
    expect((await webhook(legacyRef, PLATFORM_KEY)).status).toBe(401); // wrong key for a legacy payment
    expect(await payments.confirmPayment(admin, { businessId: BIZ, paymentId: legacy!.id })).toMatchObject({ outcome: "paid" });
  });
});
