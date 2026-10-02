import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/observability/logger";
import { isScheduledTask, runScheduledTask, SCHEDULED_TASKS } from "@/jobs/scheduled";

// Tasks can take a while (renewals, follow-ups); never cache.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MIN_SECRET_LENGTH = 24;

function authorized(request: NextRequest) {
  const secret = serverEnv().CRON_SECRET?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) return false;
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Runs one scheduled task. Called by Coolify scheduled tasks
 * (`node scripts/cron.mjs <task>`), authenticated with CRON_SECRET.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ task: string }> }) {
  const { task } = await params;
  if (!authorized(request)) {
    logger.warn("cron.unauthorized", { task });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isScheduledTask(task)) return NextResponse.json({ error: "unknown task", tasks: Object.keys(SCHEDULED_TASKS) }, { status: 404 });
  const res = await runScheduledTask(task);
  return NextResponse.json({ task, ...res }, { status: res.status === "error" ? 500 : 200 });
}
