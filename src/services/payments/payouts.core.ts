/**
 * Pure rules for bank-account payouts (Paystack subaccounts). No I/O.
 */

export type CommissionSettings = { percent: number; flatMinor: number };

export const DEFAULT_COMMISSION: CommissionSettings = { percent: 0, flatMinor: 0 };

/** Nigerian NUBAN account numbers are exactly 10 digits. */
export function isValidAccountNumber(v: string) {
  return /^[0-9]{10}$/.test(v);
}

/**
 * SellFlow's cut of a sale collected for a merchant: percent + flat fee,
 * rounded to the kobo, and never more than the sale minus ₦1 (Paystack
 * rejects a charge that consumes the whole amount).
 */
export function platformFeeMinor(amountMinor: number, c: CommissionSettings): number {
  if (amountMinor <= 0) return 0;
  const raw = Math.round((amountMinor * c.percent) / 100) + c.flatMinor;
  return Math.max(0, Math.min(raw, amountMinor - 100));
}

export function describeCommission(c: CommissionSettings, currencySymbol = "₦") {
  const parts = [];
  if (c.percent > 0) parts.push(`${c.percent}%`);
  if (c.flatMinor > 0) parts.push(`${currencySymbol}${(c.flatMinor / 100).toLocaleString("en-NG")}`);
  return parts.length ? parts.join(" + ") + " per sale" : "no SellFlow fee";
}
