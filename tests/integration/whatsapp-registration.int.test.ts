/**
 * Integration: WhatsApp number registration (Cloud API) against a real
 * Supabase project and a private mock Graph API (scripts/mock-graph.mjs).
 * Uses a throwaway business that is deleted afterwards.
 *
 *   RUN_INTEGRATION=1 E2E_BUSINESS_ID=<any> npm run test:integration
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const run = Boolean(process.env.RUN_INTEGRATION && process.env.CREDENTIALS_ENCRYPTION_KEY);
const PORT = 8396;
const MOCK = `http://127.0.0.1:${PORT}`;

describe.skipIf(!run)("WhatsApp number registration (integration)", { timeout: 60_000 }, async () => {
  const saved = process.env.META_GRAPH_BASE_URL;
  process.env.META_GRAPH_BASE_URL = MOCK; // read once by serverEnv: set before importing app modules

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { decryptSecret } = await import("@/lib/security/crypto");
  const svc = await import("@/services/whatsapp/accounts.service");

  const admin = createAdminClient();
  let mock: ChildProcess;
  let businessId = "";
  let userId = "";
  const token = `EAAtest${randomBytes(16).toString("hex")}`;
  const numberId = () => String(10 ** 15 + (randomBytes(6).readUIntBE(0, 6) % 10 ** 14));
  const setNumber = (id: string, state: Record<string, unknown>) => fetch(`${MOCK}/__number/${id}`, { method: "POST", body: JSON.stringify(state) });
  const numberOnMeta = (id: string) => fetch(`${MOCK}/__number/${id}`).then((r) => r.json() as Promise<{ registered: boolean; pin: string | null }>);
  const storedPin = async (id: string) => {
    const { data } = await admin.from("business_credentials").select("ciphertext").eq("business_id", businessId).eq("provider", "whatsapp").eq("label", `pin:${id}`).maybeSingle();
    return data ? decryptSecret(data.ciphertext, businessId) : null;
  };
  const connect = (phoneNumberId: string) => svc.connectWhatsAppAccount(admin, { businessId, token, wabaId: "9000000000001", phoneNumberId, register: true });

  beforeAll(async () => {
    mock = spawn(process.execPath, ["scripts/mock-graph.mjs", String(PORT)], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) {
      if (await fetch(`${MOCK}/__number/1`).then(() => true, () => false)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const { data: anyUser } = await admin.from("profiles").select("id").limit(1).single();
    userId = anyUser!.id;
    const slug = `wa-reg-test-${randomBytes(4).toString("hex")}`;
    const { data: biz } = await admin.from("businesses").insert({ name: "WA Registration Test", slug }).select("id").single();
    businessId = biz!.id;
    const { data: pro } = await admin.from("subscription_plans").select("id").eq("code", "pro").single();
    await admin.from("subscriptions").insert({ business_id: businessId, plan_id: pro!.id, status: "active" });
  });

  // Each test connects a number; free the plan's number slots between tests.
  afterEach(async () => {
    await admin.from("whatsapp_accounts").update({ status: "disconnected" }).eq("business_id", businessId);
  });

  afterAll(async () => {
    if (businessId) await admin.from("businesses").delete().eq("id", businessId);
    mock?.kill();
    process.env.META_GRAPH_BASE_URL = saved;
  });

  it("a number that's already registered connects without re-registering (no PIN mismatch)", async () => {
    const id = numberId();
    await setNumber(id, { registered: true, pin: "111111" }); // e.g. registered by an earlier attempt whose PIN was lost
    const account = await connect(id);
    expect(account.status).toBe("connected");
    expect((await numberOnMeta(id)).pin).toBe("111111"); // untouched
  });

  it("a new number is registered, and its PIN is saved", async () => {
    const id = numberId();
    await setNumber(id, { registered: false, pin: null });
    const account = await connect(id);
    expect(account.status).toBe("connected");
    const meta = await numberOnMeta(id);
    expect(meta.registered).toBe(true);
    expect(await storedPin(id)).toBe(meta.pin);
  });

  it("Check again fixes a number stuck in Needs attention and sets a PIN SellFlow knows", async () => {
    const id = numberId();
    await setNumber(id, { registered: true, pin: "222222" });
    const account = await connect(id);
    await admin.from("whatsapp_accounts").update({ status: "error", last_error: "Registration incomplete: stale" }).eq("id", account.id); // the production situation
    const res = await svc.refreshRegistration(admin, { businessId, accountId: account.id, userId });
    expect(res).toEqual({ connected: true, error: null });
    const { data: row } = await admin.from("whatsapp_accounts").select("status, last_error").eq("id", account.id).single();
    expect(row).toEqual({ status: "connected", last_error: null });
    const pin = await storedPin(id);
    expect(pin).toMatch(/^[0-9]{6}$/);
    expect((await numberOnMeta(id)).pin).toBe(pin); // the unknown PIN was replaced by one SellFlow stored
  });

  it("an unregistered number with an unknown PIN asks for the PIN, and the right PIN finishes it", async () => {
    const id = numberId();
    await setNumber(id, { registered: false, pin: "654321" });
    const account = await connect(id);
    expect(account.status).toBe("error");
    const { data: row } = await admin.from("whatsapp_accounts").select("last_error").eq("id", account.id).single();
    expect(row!.last_error).toMatch(/two-step verification PIN/);
    expect((await svc.refreshRegistration(admin, { businessId, accountId: account.id, userId })).connected).toBe(false);
    await expect(svc.registerWhatsAppNumber(admin, { businessId, accountId: account.id, pin: "000000", userId })).rejects.toThrow(/doesn't match/);
    await svc.registerWhatsAppNumber(admin, { businessId, accountId: account.id, pin: "654321", userId });
    const { data: done } = await admin.from("whatsapp_accounts").select("status").eq("id", account.id).single();
    expect(done!.status).toBe("connected");
  });
});
