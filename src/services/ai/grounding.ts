/**
 * "Never invent prices" enforcement. Every money amount in an AI reply must be
 * an amount SellFlow itself produced during this turn (tool results, business
 * delivery fees, the customer's own recent orders) — or the sum of such amounts,
 * or a quantity multiple. A failing reply isn't sent: the AI gets one retry with
 * the problem pointed out, then the conversation is handed to a human.
 */

// Symbols / ISO codes — case-sensitive with word boundaries, so ordinary words
// ("takes 1-2 days", "for 2 bags") never read as currency: ₦45,000 · NGN 45000 · N45,000 · $12.50
const SYMBOL_AMOUNT = /(?:₦|\$|GH₵|\b(?:NGN|USD|GHS|KES|KSh|ZAR)\s?|\bN(?=\d)|\bR(?=\d))\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(k)?(?![\d,])/g;
// Spelled-out currency — case-insensitive: "45,000 naira", "45k Naira"
const WORD_AMOUNT = /\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(k)?\s?(?:naira|cedis?|shillings?|rand)\b/gi;

function toMinor(whole: string, frac: string | undefined, k: string | undefined) {
  let minor = Number(whole.replace(/,/g, "")) * 100 + Number((frac ?? "").padEnd(2, "0") || 0);
  if (k) minor *= 1000;
  return minor;
}

export function extractAmountsMinor(input: string): number[] {
  // Links (e.g. Paystack checkout URLs) are not prices: "…/N5x2" must not read as ₦5.
  const text = input.replace(/https?:\/\/\S+/g, " ");
  const found: { at: number; minor: number }[] = [];
  for (const m of text.matchAll(SYMBOL_AMOUNT)) found.push({ at: m.index ?? 0, minor: toMinor(m[1], m[2], m[3]) });
  for (const m of text.matchAll(WORD_AMOUNT)) found.push({ at: m.index ?? 0, minor: toMinor(m[1], m[2], m[3]) });
  return found.sort((a, b) => a.at - b.at).map((f) => f.minor);
}

/** Collects every integer that looks like a minor-unit money value from tool outputs. */
export function collectGroundedAmounts(values: unknown[], into = new Set<number>()): Set<number> {
  const visit = (v: unknown, key = "") => {
    if (v == null) return;
    if (typeof v === "number" && /(_minor|minor)$/.test(key) && Number.isInteger(v)) into.add(v);
    else if (Array.isArray(v)) v.forEach((x) => visit(x, key));
    else if (typeof v === "object") Object.entries(v as Record<string, unknown>).forEach(([k, x]) => visit(x, k));
  };
  values.forEach((v) => visit(v));
  return into;
}

export type GroundingResult = { ok: true } | { ok: false; ungrounded: number[] };

export function checkPriceGrounding(reply: string, grounded: Set<number>): GroundingResult {
  const amounts = extractAmountsMinor(reply);
  if (!amounts.length) return { ok: true };

  const base = [...grounded].filter((n) => n > 0);
  // ₦0 is fine when a tool returned it (e.g. free pickup); it just isn't multiplied or summed.
  const allowed = new Set(grounded);
  // Quantity multiples (2 × ₦45,000) and pairwise sums (item + delivery).
  for (const a of base) for (let q = 2; q <= 10; q++) allowed.add(a * q);
  for (const a of base) for (const b of base) allowed.add(a + b);

  const ungrounded = amounts.filter((a) => !allowed.has(a));
  return ungrounded.length ? { ok: false, ungrounded } : { ok: true };
}
