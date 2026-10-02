export const DAY_MS = 86_400_000;

export function daysAgoIso(days: number, from = new Date()) {
  return new Date(from.getTime() - days * DAY_MS).toISOString();
}

export function daysUntil(iso: string, from = new Date()) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - from.getTime()) / DAY_MS));
}

/** First day of the current UTC month as YYYY-MM-DD (usage period key). */
export function currentUsagePeriod(from = new Date()) {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
