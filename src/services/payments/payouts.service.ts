import "server-only";

import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/observability/logger";
import { paystackClient, PaystackError } from "@/lib/paystack/client";
import type { DbClient } from "@/lib/supabase/types";

import { DEFAULT_COMMISSION, isValidAccountNumber, type CommissionSettings } from "./payouts.core";

/**
 * Bank-account payouts: how every merchant is paid.
 * The account becomes a Paystack subaccount of SellFlow's platform account;
 * sales are split to it and Paystack settles straight to the merchant's bank.
 */

export class PayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutError";
  }
}

function platform() {
  const key = serverEnv().PAYSTACK_SECRET_KEY;
  if (!key) throw new PayoutError("Bank payouts aren't available on this installation yet.");
  return paystackClient(key);
}

export function arePayoutsAvailable() {
  return Boolean(serverEnv().PAYSTACK_SECRET_KEY);
}

// Bank list changes rarely; cache it per server instance.
let bankCache: { at: number; banks: { name: string; code: string }[] } | null = null;
const BANK_TTL_MS = 12 * 60 * 60 * 1000;

export async function listBanks(): Promise<{ name: string; code: string }[]> {
  if (bankCache && Date.now() - bankCache.at < BANK_TTL_MS) return bankCache.banks;
  const all = await platform().listBanks();
  const banks = all
    .filter((b) => b.active !== false && (!b.currency || b.currency === "NGN") && (!b.type || b.type === "nuban"))
    .map((b) => ({ name: b.name, code: b.code }))
    .sort((a, b) => a.name.localeCompare(b.name));
  bankCache = { at: Date.now(), banks };
  return banks;
}

async function bankName(code: string) {
  const bank = (await listBanks()).find((b) => b.code === code);
  if (!bank) throw new PayoutError("Choose your bank from the list.");
  return bank.name;
}

/** Looks the account up with Paystack. The returned name is what the merchant confirms. */
export async function verifyBankAccount(p: { bankCode: string; accountNumber: string }) {
  if (!isValidAccountNumber(p.accountNumber)) throw new PayoutError("Enter your 10-digit account number.");
  const name = await bankName(p.bankCode);
  try {
    const res = await platform().resolveAccount(p.accountNumber, p.bankCode);
    return { accountName: res.account_name, bankName: name };
  } catch (err) {
    if (err instanceof PaystackError && err.status < 500) throw new PayoutError("We couldn't find that account at this bank. Check the number and bank.");
    throw new PayoutError("We couldn't reach the bank to check this account. Please try again.");
  }
}

export type PayoutAccount = {
  bank_name: string;
  bank_code: string;
  account_number_last4: string;
  account_name: string;
  subaccount_code: string;
  status: string;
  updated_at: string;
};

export async function getPayoutAccount(db: DbClient, businessId: string): Promise<PayoutAccount | null> {
  const { data } = await db
    .from("payout_accounts")
    .select("bank_name, bank_code, account_number_last4, account_name, subaccount_code, status, updated_at")
    .eq("business_id", businessId)
    .maybeSingle();
  return data;
}

/**
 * Sets (or changes) where a business is paid. The account is looked up again
 * here — nothing from the browser is trusted — then the Paystack subaccount
 * is created or updated. Owner-only (checked by the caller); audited and the
 * team is notified, because a changed payout account is a fraud signal.
 */
export async function connectPayoutAccount(admin: DbClient, p: { businessId: string; bankCode: string; accountNumber: string; userId: string; userEmail?: string }) {
  const { accountName, bankName: bank } = await verifyBankAccount(p);
  const { data: biz } = await admin.from("businesses").select("name").eq("id", p.businessId).single();
  const existing = await getPayoutAccount(admin, p.businessId);
  const client = platform();

  let subaccountCode: string;
  try {
    if (existing) {
      await client.updateSubaccount(existing.subaccount_code, { bankCode: p.bankCode, accountNumber: p.accountNumber, businessName: biz?.name, active: true });
      subaccountCode = existing.subaccount_code;
    } else {
      const created = await client.createSubaccount({
        businessName: biz?.name ?? "SellFlow merchant",
        bankCode: p.bankCode,
        accountNumber: p.accountNumber,
        // The platform's cut is set per transaction (transaction_charge); the default split gives the merchant everything.
        percentageCharge: 0,
        description: `SellFlow business ${p.businessId}`,
        email: p.userEmail,
      });
      subaccountCode = created.subaccount_code;
    }
  } catch (err) {
    logger.error("payouts.subaccount_failed", err, { business_id: p.businessId });
    throw new PayoutError(err instanceof PaystackError ? `Paystack couldn't set up payouts: ${err.message}` : "Paystack couldn't set up payouts. Please try again.");
  }

  const row = {
    business_id: p.businessId,
    bank_code: p.bankCode,
    bank_name: bank,
    account_number_last4: p.accountNumber.slice(-4),
    account_name: accountName,
    subaccount_code: subaccountCode,
    status: "active",
    created_by: p.userId,
  };
  const { error } = await admin.from("payout_accounts").upsert(row, { onConflict: "business_id" });
  if (error) throw error;

  await admin.from("audit_logs").insert({
    business_id: p.businessId,
    actor_user_id: p.userId,
    action: existing ? "payouts.account_changed" : "payouts.account_added",
    entity_type: "payout_account",
    metadata: { bank, last4: row.account_number_last4, account_name: accountName, previous: existing ? { bank: existing.bank_name, last4: existing.account_number_last4 } : null },
  });
  await admin.from("notifications").insert({
    business_id: p.businessId,
    type: "payouts.account_changed",
    title: existing ? "Payout bank account changed" : "Payout bank account added",
    body: `Customer payments will be settled to ${bank} •••• ${row.account_number_last4} (${accountName}). If you didn't make this change, contact support immediately.`,
  });
  return { bankName: bank, accountName, last4: row.account_number_last4 };
}

/** Stops bank payouts. New payment links can't be created until a method is set up again. */
export async function disablePayoutAccount(admin: DbClient, p: { businessId: string; userId: string }) {
  const existing = await getPayoutAccount(admin, p.businessId);
  if (!existing) return;
  try {
    await platform().updateSubaccount(existing.subaccount_code, { active: false });
  } catch (err) {
    logger.warn("payouts.subaccount_disable_failed", { business_id: p.businessId, error: err instanceof Error ? err.message : String(err) });
  }
  await admin.from("payout_accounts").update({ status: "disabled" }).eq("business_id", p.businessId);
  await admin.from("audit_logs").insert({ business_id: p.businessId, actor_user_id: p.userId, action: "payouts.account_disabled", entity_type: "payout_account" });
}

export async function getCommission(admin: DbClient): Promise<CommissionSettings> {
  const { data } = await admin.from("platform_settings").select("value").eq("key", "payments").maybeSingle();
  const v = (data?.value ?? {}) as { commission_percent?: number; commission_flat_minor?: number };
  return { percent: Number(v.commission_percent ?? DEFAULT_COMMISSION.percent), flatMinor: Number(v.commission_flat_minor ?? DEFAULT_COMMISSION.flatMinor) };
}
