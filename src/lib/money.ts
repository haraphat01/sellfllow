/** Money is stored as integer minor units (e.g. kobo). Never use floats for totals. */
export function formatMoney(minor: number | bigint, currency = "NGN", locale = "en-NG") {
  const major = Number(minor) / 100;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: major % 1 === 0 ? 0 : 2,
  }).format(major);
}

export function toMinor(major: number) {
  return Math.round(major * 100);
}
