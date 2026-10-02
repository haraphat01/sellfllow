import "server-only";

import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DbClient } from "@/lib/supabase/types";
import { dueFollowUps, processFollowUp, scheduleFollowUps } from "@/services/automation/follow-ups.service";
import { advanceSubscriptionStates, processRenewals, sendUsageAlerts } from "@/services/billing/billing.service";
import { findEventsToRetry } from "@/services/whatsapp/inbound.service";

import { processEvent, replyNow } from "./events";

/**
 * Timed work, triggered by Coolify scheduled tasks through /api/cron/<task>
 * (see DEPLOYMENT.md for the schedule). Every task is idempotent and safe to
 * run late, twice, or after a restart.
 */
export const SCHEDULED_TASKS = {
  /** Every 5 minutes: detect quiet leads, schedule follow-ups, send the due ones. */
  "follow-ups": { every: "*/5 * * * *", run: runFollowUps },
  /** Every 5 minutes: re-process WhatsApp events and AI replies that a restart or error interrupted. */
  "whatsapp-sweep": { every: "*/5 * * * *", run: runWhatsAppSweep },
  /** Hourly: cancel unpaid orders older than 48h so their stock returns. */
  "expire-orders": { every: "15 * * * *", run: runExpireOrders },
  /** Hourly: renewals, trial/grace/cancellation expiry, usage alerts. */
  billing: { every: "5 * * * *", run: runBilling },
} as const satisfies Record<string, { every: string; run: (admin: DbClient) => Promise<Record<string, unknown>> }>;

export type ScheduledTaskName = keyof typeof SCHEDULED_TASKS;

export function isScheduledTask(name: string): name is ScheduledTaskName {
  return Object.hasOwn(SCHEDULED_TASKS, name);
}

async function runFollowUps(admin: DbClient) {
  const scheduled = await scheduleFollowUps(admin);
  const due = await dueFollowUps(admin);
  const outcomes: Record<string, number> = {};
  for (const f of due) {
    try {
      const res = await processFollowUp(admin, f.id);
      outcomes[res.outcome] = (outcomes[res.outcome] ?? 0) + 1;
    } catch (err) {
      outcomes.error = (outcomes.error ?? 0) + 1;
      logger.error("follow_up.process_failed", err, { follow_up_id: f.id, business_id: f.business_id });
    }
  }
  return { ...scheduled, due: due.length, outcomes };
}

/** Conversations where the customer spoke last, recently, and the AI never answered (e.g. the server restarted). */
const UNANSWERED_MIN_AGE_MS = 2 * 60_000;
const UNANSWERED_MAX_AGE_MS = 6 * 60 * 60_000;

async function runWhatsAppSweep(admin: DbClient) {
  const events = await findEventsToRetry(admin);
  let reprocessed = 0;
  for (const e of events) {
    try {
      await processEvent(e);
      reprocessed++;
    } catch (err) {
      logger.error("whatsapp.sweep.event_failed", err, { webhook_event_id: e.id });
    }
  }

  const now = Date.now();
  const { data: convs, error } = await admin
    .from("conversations")
    .select("id, business_id, last_message_at, last_customer_message_at")
    .eq("status", "open")
    .eq("ai_mode", "AI_ACTIVE")
    .gte("last_customer_message_at", new Date(now - UNANSWERED_MAX_AGE_MS).toISOString())
    .lte("last_customer_message_at", new Date(now - UNANSWERED_MIN_AGE_MS).toISOString())
    .limit(100);
  if (error) throw error;
  // Inbound messages set both timestamps; any reply moves last_message_at later.
  const waiting = (convs ?? []).filter((c) => c.last_message_at === c.last_customer_message_at);
  let answered = 0;
  if (waiting.length) {
    const { data: agents } = await admin
      .from("ai_agents")
      .select("business_id")
      .eq("enabled", true)
      .in("business_id", Array.from(new Set(waiting.map((c) => c.business_id))));
    const enabled = new Set((agents ?? []).map((a) => a.business_id));
    // Skip conversations where the AI already tried after the customer's last message
    // (e.g. a reply it deliberately withheld) — retrying would just spend tokens.
    const { data: attempts } = await admin
      .from("ai_usage")
      .select("conversation_id, created_at")
      .in("conversation_id", waiting.map((c) => c.id))
      .gte("created_at", new Date(now - UNANSWERED_MAX_AGE_MS).toISOString());
    const triedAfter = (c: { id: string; last_customer_message_at: string | null }) =>
      (attempts ?? []).some((a) => a.conversation_id === c.id && c.last_customer_message_at !== null && a.created_at > c.last_customer_message_at);
    for (const c of waiting.filter((w) => enabled.has(w.business_id) && !triedAfter(w))) {
      const res = await replyNow(c.business_id, c.id);
      if (res && "outcome" in res && res.outcome === "replied") answered++;
    }
  }
  return { events_found: events.length, reprocessed, unanswered_found: waiting.length, answered };
}

async function runExpireOrders(admin: DbClient) {
  const { data, error } = await admin.rpc("expire_stale_orders", { p_older_than: "48 hours" });
  if (error) throw error;
  return { expired: data ?? 0 };
}

async function runBilling(admin: DbClient) {
  const renewals = await processRenewals(admin);
  const states = await advanceSubscriptionStates(admin);
  const alerts = await sendUsageAlerts(admin);
  return { renewals: renewals.length, ...states, alerts: alerts.sent };
}

const running = new Set<ScheduledTaskName>();

/**
 * Runs a task unless it's already running on this server, and records the
 * result in platform_settings.cron (shown in /admin → Settings).
 */
export async function runScheduledTask(name: ScheduledTaskName) {
  if (running.has(name)) return { status: "skipped" as const, reason: "already running" };
  running.add(name);
  const admin = createAdminClient();
  const startedAt = new Date();
  try {
    const result = await SCHEDULED_TASKS[name].run(admin);
    await recordRun(admin, name, { ok: true, at: startedAt.toISOString(), ms: Date.now() - startedAt.getTime(), result });
    if (Object.values(result).some((v) => typeof v === "number" && v > 0)) logger.info("cron.ran", { task: name, ...result });
    return { status: "ok" as const, result };
  } catch (err) {
    logger.error("cron.failed", err, { task: name });
    await recordRun(admin, name, { ok: false, at: startedAt.toISOString(), ms: Date.now() - startedAt.getTime(), error: err instanceof Error ? err.message : String(err) }).catch(() => undefined);
    return { status: "error" as const, error: err instanceof Error ? err.message : String(err) };
  } finally {
    running.delete(name);
  }
}

async function recordRun(admin: DbClient, name: ScheduledTaskName, run: Record<string, unknown>) {
  const { data } = await admin.from("platform_settings").select("value").eq("key", "cron").maybeSingle();
  const value = { ...((data?.value as Record<string, unknown>) ?? {}), [name]: run };
  await admin.from("platform_settings").upsert({ key: "cron", value: value as never, updated_at: new Date().toISOString() });
}

export async function getScheduledTaskRuns(admin: DbClient) {
  const { data } = await admin.from("platform_settings").select("value").eq("key", "cron").maybeSingle();
  return (data?.value ?? {}) as Partial<Record<ScheduledTaskName, { ok: boolean; at: string; ms: number; error?: string; result?: Record<string, unknown> }>>;
}
