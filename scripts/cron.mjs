#!/usr/bin/env node
// Triggers one SellFlow scheduled task on the running server. Used by Coolify
// scheduled tasks (run inside the app container), or locally:
//   node scripts/cron.mjs follow-ups
// Tasks: follow-ups, whatsapp-sweep, expire-orders, billing
// Needs CRON_SECRET in the environment (the same value the app uses).
const task = process.argv[2];
if (!task) {
  console.error("usage: node scripts/cron.mjs <follow-ups|whatsapp-sweep|expire-orders|billing>");
  process.exit(2);
}
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is not set");
  process.exit(2);
}
const base = (process.env.CRON_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/$/, "");
const res = await fetch(`${base}/api/cron/${encodeURIComponent(task)}`, {
  method: "POST",
  headers: { authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(290_000),
}).catch((err) => {
  console.error(`cron ${task}: request failed: ${err.message}`);
  process.exit(1);
});
const text = await res.text();
console.log(`cron ${task}: HTTP ${res.status} ${text}`);
process.exit(res.ok ? 0 : 1);
