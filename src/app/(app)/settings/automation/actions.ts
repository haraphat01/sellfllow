"use server";

import { revalidatePath } from "next/cache";

import { toActionError, type FormState } from "@/lib/actions";
import { authorize } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { followUpSettingsFromForm } from "@/lib/validation/follow-ups";
import { getPlan, isSubscriptionUsable } from "@/services/billing/limits";

export async function updateFollowUpSettingsAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = followUpSettingsFromForm(form);
  if (!parsed.success) {
    const fe: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) (fe[String(issue.path[0] ?? "form")] ??= []).push(issue.message);
    return { error: "Please fix the highlighted fields.", fieldErrors: fe };
  }
  const v = parsed.data;
  try {
    const ctx = await authorize("campaigns.manage");
    // Service role, scoped to the caller's business and to follow-up columns only
    // (ai_settings RLS is settings.manage; follow-ups belong to campaigns.manage).
    const admin = createAdminClient();
    if (v.enabled) {
      const plan = await getPlan(admin, ctx.business.id);
      if (!plan || !isSubscriptionUsable(plan.status) || !plan.features.follow_ups) {
        return { error: "Automated follow-ups are included from the Growth plan. Upgrade in Billing to turn them on." };
      }
    }
    const { error } = await admin
      .from("ai_settings")
      .update({
        follow_up_enabled: v.enabled,
        follow_up_delay_minutes: v.delay_minutes,
        follow_up_max: v.max,
        follow_up_message: v.message,
        follow_up_respect_hours: v.respect_hours,
        follow_up_window_start: v.window_start,
        follow_up_window_end: v.window_end,
        follow_up_template_name: v.template_name,
        follow_up_template_language: v.template_language,
        attribution_window_hours: v.attribution_window_hours,
      })
      .eq("business_id", ctx.business.id);
    if (error) throw error;
    await admin.from("audit_logs").insert({
      business_id: ctx.business.id,
      actor_type: "user",
      actor_user_id: ctx.user.id,
      action: "automation.follow_ups.updated",
      entity_type: "ai_settings",
      metadata: { enabled: v.enabled, delay_minutes: v.delay_minutes, max: v.max },
    });
    revalidatePath("/settings/automation");
    return { ok: true, message: v.enabled ? "Saved — follow-ups are on" : "Saved — follow-ups are off" };
  } catch (err) {
    return { error: toActionError(err, { action: "automation.follow_ups.update" }) };
  }
}
