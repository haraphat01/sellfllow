const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });

/** "2 min ago", "yesterday", "12 Sept". Pass `now` for deterministic output. */
export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const then = new Date(iso);
  const diff = (then.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 7 * 86400) return rtf.format(Math.round(diff / 86400), "day");
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(then.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function dayLabel(iso: string, now: Date = new Date()) {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: days < 7 ? "long" : undefined, day: "numeric", month: "long", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

export function displayName(c: { name?: string | null; profile_name?: string | null; profileName?: string | null; phone: string }) {
  return c.name || c.profile_name || c.profileName || c.phone;
}

export function initials(name: string) {
  const parts = name.replace(/^\+/, "").split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (/^\d/.test(parts[0])) return "#";
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

/** "28 Oct 2026" */
export function formatDate(iso: string | Date) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
