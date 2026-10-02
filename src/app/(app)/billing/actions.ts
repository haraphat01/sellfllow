"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionResult } from "@/lib/actions";
import { authorize } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { cancelAtPeriodEnd, changePlan, clearScheduledChange, removeSavedCard } from "@/services/billing/billing.service";

const planCode = z.string().regex(/^[a-z0-9_]{1,40}$/);

/** Returns a Paystack checkout URL to redirect to, or a message when nothing needs paying now. */
export async function changePlanAction(code: string): Promise<ActionResult<{ url?: string }>> {
  const parsed = planCode.safeParse(code);
  if (!parsed.success) return { ok: false, error: "Unknown plan." };
  try {
    const ctx = await authorize("billing.manage");
    const res = await changePlan(createAdminClient(), { businessId: ctx.business.id, planCode: parsed.data, userId: ctx.user.id, email: ctx.user.email });
    revalidatePath("/billing");
    revalidatePath("/", "layout");
    switch (res.action) {
      case "checkout":
      case "pay_renewal":
        return { ok: true, data: { url: res.url } };
      case "charged":
        return { ok: true, message: `Upgraded to ${res.planName} — charged to your saved card` };
      case "scheduled_downgrade":
        return { ok: true, message: `You'll move to ${res.planName} on ${formatDate(res.effective)}` };
      case "resumed":
        return { ok: true, message: "Your subscription will renew as normal" };
    }
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "billing.change_plan" }) };
  }
}

export async function cancelSubscriptionAction(): Promise<ActionResult> {
  try {
    const ctx = await authorize("billing.manage");
    await cancelAtPeriodEnd(createAdminClient(), { businessId: ctx.business.id, userId: ctx.user.id });
    revalidatePath("/billing");
    return { ok: true, message: "Your plan will end at the end of this billing period" };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "billing.cancel" }) };
  }
}

export async function clearScheduledChangeAction(): Promise<ActionResult> {
  try {
    const ctx = await authorize("billing.manage");
    await clearScheduledChange(createAdminClient(), { businessId: ctx.business.id, userId: ctx.user.id });
    revalidatePath("/billing");
    return { ok: true, message: "Scheduled change removed" };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "billing.clear_schedule" }) };
  }
}

export async function removeCardAction(): Promise<ActionResult> {
  try {
    const ctx = await authorize("billing.manage");
    await removeSavedCard(createAdminClient(), { businessId: ctx.business.id, userId: ctx.user.id });
    revalidatePath("/billing");
    return { ok: true, message: "Card removed. Renewals will need a payment link." };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "billing.remove_card" }) };
  }
}
