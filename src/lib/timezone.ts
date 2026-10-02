/** Wall-clock helpers for a business's IANA time zone (no dependencies). */

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

export function localParts(at: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** Falls back to UTC for an unknown zone name. */
export function safeTimeZone(timeZone: string) {
  try {
    localParts(new Date(0), timeZone);
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** UTC instant of a wall-clock time in `timeZone` (DST-safe to the hour). Day overflow is normalised. */
export function zonedTime(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const wall = Date.UTC(year, month - 1, day, hour);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), timeZone);
    const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess;
    guess = wall - offset;
  }
  return new Date(guess);
}

/** Local midnight `daysBack` days before the local day containing `at`. */
export function startOfLocalDay(at: Date, timeZone: string, daysBack = 0): Date {
  const p = localParts(at, timeZone);
  return zonedTime(p.year, p.month, p.day - daysBack, 0, timeZone);
}
