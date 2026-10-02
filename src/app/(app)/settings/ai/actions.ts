"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type FormState } from "@/lib/actions";
import { authorize } from "@/lib/auth/session";
import { logger } from "@/lib/observability/logger";
import { isAiConfigured, isModelAvailable, serverEnv } from "@/lib/env/server";
import { daysAgoIso } from "@/lib/time";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { aiSettingsFromForm } from "@/lib/validation/ai-settings";
import { previewAgentReply } from "@/services/ai/agent.service";
import type { AIToolCall } from "@/services/ai/provider";

export async function updateAiSettingsAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = aiSettingsFromForm(form);
  if (!parsed.success) {
    const fe: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] === "delivery_zones" ? `delivery_zones.${String(issue.path[1])}.${String(issue.path[2] ?? "")}` : String(issue.path[0] ?? "form");
      (fe[key] ??= []).push(issue.message);
    }
    return { error: "Please fix the highlighted fields.", fieldErrors: fe };
  }
  const v = parsed.data;
  try {
    const ctx = await authorize("settings.manage");
    const effectiveModel = v.model ?? serverEnv().AI_DEFAULT_MODEL;
    if (v.enabled && !isModelAvailable(effectiveModel)) {
      return {
        error: effectiveModel.startsWith("deepseek/")
          ? "DeepSeek isn't configured on this installation (missing DEEPSEEK_API_KEY). Choose another model or ask the platform operator."
          : "AI Gateway isn't configured on this installation (missing AI_GATEWAY_API_KEY). Choose another model or ask the platform operator.",
      };
    }
    const db = await createClient();
    const [a, s] = await Promise.all([
      db
        .from("ai_agents")
        .update({ enabled: v.enabled, name: v.name, tone: v.tone, greeting: v.greeting, language: v.language, model: v.model })
        .eq("business_id", ctx.business.id)
        .select("id"),
      db
        .from("ai_settings")
        .update({
          return_policy: v.return_policy,
          delivery_policy: v.delivery_policy,
          delivery_zones: v.delivery_zones.map((z) => ({ name: z.name, fee_minor: z.fee, eta: z.eta || null })),
          business_hours: v.business_hours ?? "",
          discount_rules: v.discount_rules,
          max_discount_percent: v.max_discount_percent,
          escalation_rules: v.escalation_rules,
          payment_rules: v.payment_rules,
        })
        .eq("business_id", ctx.business.id)
        .select("id"),
    ]);
    if (a.error || s.error) throw a.error ?? s.error;
    if (!a.data?.length || !s.data?.length) return { error: "You can't change AI settings." };
    revalidatePath("/settings/ai");
    revalidatePath("/dashboard");
    return { ok: true, message: v.enabled ? "Saved — your AI assistant is on" : "Saved — your AI assistant is off" };
  } catch (err) {
    return { error: toActionError(err, { action: "ai.settings.update" }) };
  }
}

const previewSchema = z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(1000) })).min(1).max(20);
const PREVIEW_DAILY_LIMIT = 100;

export async function previewAgentAction(
  messages: { role: "user" | "assistant"; content: string }[],
  state: Record<string, unknown> = {},
): Promise<
  | { ok: true; text: string; toolCalls: AIToolCall[]; blocked: boolean; handoff: { reason: string; summary: string } | null; state: Record<string, unknown> }
  | { ok: false; error: string }
> {
  const parsed = previewSchema.safeParse(messages);
  const parsedState = z.record(z.string(), z.unknown()).safeParse(state);
  if (!parsedState.success || JSON.stringify(parsedState.data).length > 5000) return { ok: false, error: "Invalid playground state." };
  if (!parsed.success || parsed.data.at(-1)?.role !== "user") return { ok: false, error: "Type a customer message to test." };
  try {
    const ctx = await authorize("settings.manage");
    if (!isAiConfigured()) return { ok: false, error: "AI isn't configured on this installation yet." };
    const admin = createAdminClient();
    const { count } = await admin
      .from("ai_usage")
      .select("id", { count: "exact", head: true })
      .eq("business_id", ctx.business.id)
      .is("conversation_id", null)
      .gte("created_at", daysAgoIso(1));
    if ((count ?? 0) >= PREVIEW_DAILY_LIMIT) return { ok: false, error: "You've reached today's playground limit. Try again tomorrow." };

    const res = await previewAgentReply(admin, { businessId: ctx.business.id, messages: parsed.data, state: parsedState.data });
    return { ok: true, text: res.text, toolCalls: res.toolCalls, blocked: res.blocked, handoff: res.handoff, state: res.state };
  } catch (err) {
    // Surface provider/account problems (billing, auth, rate limits) instead of a generic error.
    if (err instanceof Error && /^Gateway\w*Error$/.test(err.name)) {
      logger.warn("ai.preview.gateway_error", { error: err.name, message: err.message.slice(0, 300) });
      const firstSentence = err.message.replace(/\u001b\[[0-9;]*m/g, "").split(/(?<=\.)\s/)[0];
      return { ok: false, error: `The AI provider refused the request: ${firstSentence}` };
    }
    return { ok: false, error: toActionError(err, { action: "ai.preview" }) };
  }
}
