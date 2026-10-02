import "server-only";

import { after } from "next/server";

import { logger } from "@/lib/observability/logger";

/**
 * In-process background work for a single, long-running Node server (SellFlow
 * runs as one container on Coolify). Replaces Inngest:
 *
 *   inBackground   run after the HTTP response is sent (Next.js `after()`)
 *   serialized     one task at a time per key (e.g. per conversation), in order
 *   debounced      wait for a burst to settle before running (per key)
 *   withRetries    retry with backoff
 *
 * Nothing here survives a restart: anything interrupted is picked up by the
 * scheduled sweeps (/api/cron/*), which re-check the database.
 */

/** Runs `task` after the current response (or right away when there's no request, e.g. inside a timer). */
export function inBackground(name: string, task: () => Promise<unknown>) {
  const run = () =>
    task().catch((err) => {
      logger.error("job.failed", err, { job: name });
    });
  try {
    after(run);
  } catch {
    // Not inside a request (timers, cron work): just start it.
    void run();
  }
}

const chains = new Map<string, Promise<unknown>>();

/** Runs tasks with the same key one after another, in call order. Errors don't break the chain. */
export function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  const settled = next.catch(() => undefined);
  chains.set(key, settled);
  void settled.then(() => {
    if (chains.get(key) === settled) chains.delete(key);
  });
  return next;
}

const timers = new Map<string, { timer: ReturnType<typeof setTimeout>; firstAt: number }>();

/**
 * Debounce per key: `task` runs `waitMs` after the last call, but never later
 * than `maxWaitMs` after the first call of a burst.
 */
export function debounced(key: string, waitMs: number, maxWaitMs: number, task: () => Promise<unknown>, now = Date.now()) {
  const existing = timers.get(key);
  const firstAt = existing?.firstAt ?? now;
  if (existing) clearTimeout(existing.timer);
  const delay = Math.max(0, Math.min(waitMs, firstAt + maxWaitMs - now));
  const timer = setTimeout(() => {
    timers.delete(key);
    task().catch((err) => logger.error("job.failed", err, { job: `debounced:${key}` }));
  }, delay);
  timers.set(key, { timer, firstAt });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries `task` up to `attempts` times with exponential backoff (base, ×4, ×16 …). Rethrows the last error. */
export async function withRetries<T>(task: () => Promise<T>, opts: { attempts: number; baseDelayMs?: number; name?: string }): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < opts.attempts; i++) {
    try {
      return await task();
    } catch (err) {
      lastError = err;
      if (i < opts.attempts - 1) {
        logger.warn("job.retrying", { job: opts.name, attempt: i + 1, error: err instanceof Error ? err.message : String(err) });
        await sleep((opts.baseDelayMs ?? 1000) * 4 ** i);
      }
    }
  }
  throw lastError;
}

/** For tests: forget pending timers/chains. */
export function resetJobRunner() {
  for (const { timer } of timers.values()) clearTimeout(timer);
  timers.clear();
  chains.clear();
}
