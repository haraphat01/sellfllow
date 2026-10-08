import "server-only";

import type { DbClient } from "@/lib/supabase/types";

/**
 * AI auto-resume. A person can take over any conversation (replying does it
 * automatically), but if the customer then waits longer than the business's
 * `ai_resume_after_minutes` without a reply from the team, the AI picks the
 * conversation back up so nobody is left waiting. "Paused" never resumes.
 */

export const DEFAULT_AI_RESUME_AFTER_MINUTES = 15;
/** WhatsApp only allows free-form replies within 24h of the customer's last message. */
const SERVICE_WINDOW_MS = 24 * 60 * 60_000;

type Candidate = { id: string; business_id: string; last_message_at: string | null; last_customer_message_at: string | null };
type TeamActivity = { conversation_id: string; type: string; created_at: string };

/**
 * True when the customer spoke last and has waited at least `resumeAfterMinutes`,
 * with no sign of the team since: no takeover in that time, and no handoff the AI
 * raised after the customer's message (that means the AI couldn't run, e.g. plan limits).
 */
export function isDueForAiResume(c: Candidate, resumeAfterMinutes: number, activity: TeamActivity[], now: Date): boolean {
  if (!resumeAfterMinutes || !c.last_customer_message_at) return false;
  // Inbound messages set both timestamps; any reply (staff, AI or system) moves last_message_at later.
  if (c.last_message_at !== c.last_customer_message_at) return false;
  const waitedFrom = Date.parse(c.last_customer_message_at);
  const cutoff = now.getTime() - resumeAfterMinutes * 60_000;
  if (waitedFrom > cutoff) return false;
  for (const a of activity) {
    if (a.conversation_id !== c.id) continue;
    const at = Date.parse(a.created_at);
    if (a.type === "human_takeover" && at > cutoff) return false;
    if (a.type === "handoff_requested" && at >= waitedFrom) return false;
  }
  return true;
}

/** Human-handled conversations whose customer has waited too long for the team. */
export async function findConversationsToResume(admin: DbClient, now = new Date()) {
  const { data: convs, error } = await admin
    .from("conversations")
    .select("id, business_id, last_message_at, last_customer_message_at")
    .eq("status", "open")
    .eq("ai_mode", "HUMAN_ACTIVE")
    .gte("last_customer_message_at", new Date(now.getTime() - SERVICE_WINDOW_MS).toISOString())
    .lte("last_customer_message_at", new Date(now.getTime() - 60_000).toISOString())
    .limit(200);
  if (error) throw error;
  const waiting = (convs ?? []).filter((c) => c.last_message_at === c.last_customer_message_at);
  if (!waiting.length) return [];

  const businessIds = Array.from(new Set(waiting.map((c) => c.business_id)));
  const [{ data: settings }, { data: agents }, { data: activity }] = await Promise.all([
    admin.from("ai_settings").select("business_id, ai_resume_after_minutes").in("business_id", businessIds),
    admin.from("ai_agents").select("business_id").eq("enabled", true).in("business_id", businessIds),
    admin
      .from("conversation_events")
      .select("conversation_id, type, created_at")
      .in("conversation_id", waiting.map((c) => c.id))
      .in("type", ["human_takeover", "handoff_requested"])
      .gte("created_at", new Date(now.getTime() - SERVICE_WINDOW_MS).toISOString()),
  ]);
  const resumeAfter = new Map((settings ?? []).map((s) => [s.business_id, s.ai_resume_after_minutes]));
  const enabled = new Set((agents ?? []).map((a) => a.business_id));

  return waiting
    .filter((c) => enabled.has(c.business_id))
    .map((c) => ({ ...c, resumeAfterMinutes: resumeAfter.get(c.business_id) ?? DEFAULT_AI_RESUME_AFTER_MINUTES }))
    .filter((c) => isDueForAiResume(c, c.resumeAfterMinutes, activity ?? [], now));
}

/** Hands the conversation back to the AI (only if a person still has it). Returns false if something changed meanwhile. */
export async function resumeAiAfterWait(admin: DbClient, c: { id: string; business_id: string; resumeAfterMinutes: number }) {
  const { data, error } = await admin
    .from("conversations")
    .update({ ai_mode: "AI_ACTIVE" })
    .eq("business_id", c.business_id)
    .eq("id", c.id)
    .eq("status", "open")
    .eq("ai_mode", "HUMAN_ACTIVE")
    .select("id");
  if (error) throw error;
  if (!data?.length) return false;
  // needs_attention stays on: the team still owes the customer a reply.
  await admin.from("conversation_events").insert({
    business_id: c.business_id,
    conversation_id: c.id,
    type: "ai_resumed",
    actor_type: "system",
    data: { reason: "no_team_reply", after_minutes: c.resumeAfterMinutes },
  });
  return true;
}
