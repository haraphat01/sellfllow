"use server";

import { revalidatePath } from "next/cache";

import { toActionError, type ActionResult, type FormState } from "@/lib/actions";
import { authorizePlatformAdmin } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { extendTrialSchema, grantPlanSchema, planFromForm, platformSettingsSchema, suspendSchema } from "@/lib/validation/admin";
import { extendTrial, grantPlan, savePlan, savePlatformSettings, setBusinessSuspended } from "@/services/admin/admin.service";

const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Invalid input.";

export async function setSuspendedAction(input: { businessId: string; suspend: boolean; reason: string }): Promise<ActionResult> {
  const parsed = suspendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const user = await authorizePlatformAdmin();
    await setBusinessSuspended(createAdminClient(), { ...parsed.data, adminId: user.id });
    revalidatePath(`/admin/businesses/${parsed.data.businessId}`);
    revalidatePath("/admin");
    return { ok: true, message: parsed.data.suspend ? "Business suspended" : "Business reinstated" };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "admin.suspend" }) };
  }
}

export async function grantPlanAction(input: { businessId: string; planCode: string; days: number; reason: string }): Promise<ActionResult> {
  const parsed = grantPlanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const user = await authorizePlatformAdmin();
    const res = await grantPlan(createAdminClient(), { ...parsed.data, adminId: user.id });
    revalidatePath(`/admin/businesses/${parsed.data.businessId}`);
    return { ok: true, message: `${res.planName} granted until ${formatDate(res.until)}` };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "admin.grant_plan" }) };
  }
}

export async function extendTrialAction(input: { businessId: string; days: number; reason: string }): Promise<ActionResult> {
  const parsed = extendTrialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const user = await authorizePlatformAdmin();
    const res = await extendTrial(createAdminClient(), { ...parsed.data, adminId: user.id });
    revalidatePath(`/admin/businesses/${parsed.data.businessId}`);
    return { ok: true, message: `Trial runs until ${formatDate(res.until)}` };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "admin.extend_trial" }) };
  }
}

export async function savePlanAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = planFromForm(form);
  if (!parsed.success) {
    const fe: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) (fe[issue.path.join(".")] ??= []).push(issue.message);
    return { error: "Please fix the highlighted fields.", fieldErrors: fe };
  }
  const existingId = String(form.get("id") ?? "") || null;
  if (existingId && !/^[0-9a-f-]{36}$/.test(existingId)) return { error: "Invalid plan." };
  try {
    const user = await authorizePlatformAdmin();
    await savePlan(createAdminClient(), { plan: parsed.data, existingId, adminId: user.id });
    revalidatePath("/admin/plans");
    revalidatePath("/billing");
    return { ok: true, message: existingId ? `${parsed.data.name} saved` : `${parsed.data.name} created` };
  } catch (err) {
    return { error: toActionError(err, { action: "admin.save_plan" }) };
  }
}

export async function saveSettingsAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = platformSettingsSchema.safeParse({
    trial_days: form.get("trial_days"),
    commission_percent: form.get("commission_percent") || 0,
    commission_flat: String(form.get("commission_flat") ?? ""),
  });
  if (!parsed.success) {
    const fe: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) (fe[String(issue.path[0])] ??= []).push(issue.message);
    return { error: "Please fix the highlighted fields.", fieldErrors: fe };
  }
  try {
    const user = await authorizePlatformAdmin();
    await savePlatformSettings(createAdminClient(), {
      trialDays: parsed.data.trial_days,
      commissionPercent: parsed.data.commission_percent,
      commissionFlatMinor: parsed.data.commission_flat,
      adminId: user.id,
    });
    revalidatePath("/admin/settings");
    return { ok: true, message: "Settings saved" };
  } catch (err) {
    return { error: toActionError(err, { action: "admin.settings" }) };
  }
}
