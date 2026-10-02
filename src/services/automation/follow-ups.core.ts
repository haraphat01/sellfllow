/**
 * Pure follow-up helpers (message rendering, sending hours). No I/O, so they
 * are unit-tested directly.
 */
import { localParts, safeTimeZone, zonedTime } from "@/lib/timezone";

export type FollowUpContent =
  | { kind: "pending_order"; orderNumber: number; total: string; paymentLink: string | null }
  | { kind: "product"; productName: string }
  | { kind: "general" };

export const FOLLOW_UP_PLACEHOLDERS = ["{name}", "{product}"] as const;

export const DEFAULT_FOLLOW_UP_MESSAGE =
  "Hi {name} 👋 Just checking in about the {product} you asked about — it's still available. Would you like me to help you complete your order?";
const GENERAL_MESSAGE = "Hi {name} 👋 Just checking in — would you like me to help you complete your order?";

/**
 * Builds the follow-up text. The merchant's message is used for product
 * interest; an unpaid order always gets the order reminder (with its link),
 * because that's the message most likely to recover the sale.
 */
export function renderFollowUp(c: FollowUpContent & { customerFirstName: string }, merchantMessage: string | null): string {
  const name = c.customerFirstName.trim() || "there";
  if (c.kind === "pending_order") {
    const pay = c.paymentLink ? `You can complete payment here: ${c.paymentLink}` : "Reply here and I'll send you a payment link.";
    return `Hi ${name} 👋 Your order #${c.orderNumber} (${c.total}) is still waiting for payment. ${pay}`;
  }
  const custom = merchantMessage?.trim();
  let template = custom || DEFAULT_FOLLOW_UP_MESSAGE;
  if (c.kind === "general" && template.includes("{product}")) template = GENERAL_MESSAGE;
  return template
    .replaceAll("{name}", name)
    .replaceAll("{product}", c.kind === "product" ? c.productName : "")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

/**
 * Earliest time at or after `now` within the daily sending window
 * [startHour, endHour) in the business's time zone.
 */
export function nextSendTime(now: Date, timeZone: string, startHour: number, endHour: number): Date {
  const tz = safeTimeZone(timeZone);
  const p = localParts(now, tz);
  if (p.hour >= startHour && p.hour < endHour) return now;
  return zonedTime(p.year, p.month, p.hour < startHour ? p.day : p.day + 1, startHour, tz);
}
