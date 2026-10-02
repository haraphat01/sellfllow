"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionResult, type FormState } from "@/lib/actions";
import { authorize } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveBankTransferSettings } from "@/services/payments/bank-transfer.service";
import { connectPayoutAccount, disablePayoutAccount, verifyBankAccount } from "@/services/payments/payouts.service";

// ---------------------------------------------------------------------------
// Bank-account payouts (owner only: this decides where the money goes)
// ---------------------------------------------------------------------------
const bankInput = z.object({ bankCode: z.string().trim().regex(/^[0-9A-Za-z-]{2,20}$/), accountNumber: z.string().trim().regex(/^[0-9]{10}$/, "Enter your 10-digit account number.") });
const LOOKUPS_PER_HOUR = 20;

export async function verifyBankAccountAction(input: { bankCode: string; accountNumber: string }): Promise<ActionResult<{ accountName: string; bankName: string }>> {
  const parsed = bankInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the bank and account number." };
  try {
    const ctx = await authorize("settings.manage");
    if (ctx.role !== "owner") return { ok: false, error: "Only the business owner can set the payout account." };
    const admin = createAdminClient();
    // Account-name lookups reveal names: keep them rate-limited and on record.
    const { count } = await admin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", ctx.business.id)
      .eq("action", "payouts.account_lookup")
      .gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
    if ((count ?? 0) >= LOOKUPS_PER_HOUR) return { ok: false, error: "Too many account checks. Please try again in an hour." };
    await admin.from("audit_logs").insert({ business_id: ctx.business.id, actor_user_id: ctx.user.id, action: "payouts.account_lookup", metadata: { bank_code: parsed.data.bankCode, last4: parsed.data.accountNumber.slice(-4) } });
    const res = await verifyBankAccount(parsed.data);
    return { ok: true, data: res };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "payouts.verify" }) };
  }
}

export async function connectPayoutAccountAction(input: { bankCode: string; accountNumber: string }): Promise<ActionResult> {
  const parsed = bankInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the bank and account number." };
  try {
    const ctx = await authorize("settings.manage");
    if (ctx.role !== "owner") return { ok: false, error: "Only the business owner can set the payout account." };
    const res = await connectPayoutAccount(createAdminClient(), { businessId: ctx.business.id, ...parsed.data, userId: ctx.user.id, userEmail: ctx.user.email });
    revalidatePath("/settings/payments");
    revalidatePath("/dashboard");
    return { ok: true, message: `Payments will be settled to ${res.bankName} •••• ${res.last4}` };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "payouts.connect" }) };
  }
}

export async function disablePayoutAccountAction(): Promise<ActionResult> {
  try {
    const ctx = await authorize("settings.manage");
    if (ctx.role !== "owner") return { ok: false, error: "Only the business owner can change the payout account." };
    await disablePayoutAccount(createAdminClient(), { businessId: ctx.business.id, userId: ctx.user.id });
    revalidatePath("/settings/payments");
    return { ok: true, message: "Bank payouts turned off" };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "payouts.disable" }) };
  }
}

// ---------------------------------------------------------------------------
// Manual bank transfer (owner only: this is where customers send money)
// ---------------------------------------------------------------------------
const bankTransferInput = z.object({
  enabled: z.boolean(),
  bankName: z.string().trim().min(2, "Enter the bank name").max(80),
  accountNumber: z.string().trim().regex(/^[0-9]{10}$/, "Enter the 10-digit account number"),
  accountName: z.string().trim().min(2, "Enter the account name").max(120),
  instructions: z.string().trim().max(500).transform((v) => v || null),
});

export async function saveBankTransferAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = bankTransferInput.safeParse({
    enabled: form.get("enabled") === "on",
    bankName: String(form.get("bankName") ?? ""),
    accountNumber: String(form.get("accountNumber") ?? "").replace(/\s/g, ""),
    accountName: String(form.get("accountName") ?? ""),
    instructions: String(form.get("instructions") ?? ""),
  });
  if (!parsed.success) return { error: "Please fix the highlighted fields.", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  try {
    const ctx = await authorize("settings.manage");
    if (ctx.role !== "owner") return { error: "Only the business owner can set the account customers pay into." };
    await saveBankTransferSettings(createAdminClient(), { businessId: ctx.business.id, userId: ctx.user.id, ...parsed.data });
    revalidatePath("/settings/payments");
    revalidatePath("/dashboard");
    return { ok: true, message: parsed.data.enabled ? "Bank transfer is on" : "Saved — bank transfer is off" };
  } catch (err) {
    return { error: toActionError(err, { action: "payments.bank_transfer.save" }) };
  }
}
