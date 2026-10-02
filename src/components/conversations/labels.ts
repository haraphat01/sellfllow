import type { Enums } from "@/db/types/database";

export const STAGE_LABEL: Record<Enums<"purchase_stage">, string> = {
  new: "New",
  product_discovery: "Browsing",
  product_question: "Asking about a product",
  purchase_intent: "Wants to buy",
  collecting_customer_details: "Collecting details",
  order_confirmation: "Confirming order",
  payment_pending: "Payment pending",
  paid: "Paid",
  delivery: "Out for delivery",
  completed: "Completed",
  human_handoff: "Needs human support",
};

export const AI_MODE_LABEL: Record<Enums<"ai_mode">, string> = {
  AI_ACTIVE: "AI active",
  HUMAN_ACTIVE: "Human",
  PAUSED: "AI paused",
};

/** One-line status for the inbox list, most urgent first. */
export function inboxStatus(c: {
  needsAttention: boolean;
  purchaseStage: Enums<"purchase_stage">;
  interestedIn: string | null;
}): { label: string; tone: "danger" | "warning" | "success" | "muted" } | null {
  if (c.needsAttention || c.purchaseStage === "human_handoff") return { label: "Needs human support", tone: "danger" };
  if (c.purchaseStage === "payment_pending") return { label: "Payment pending", tone: "warning" };
  if (c.purchaseStage === "paid") return { label: "Paid", tone: "success" };
  if (c.interestedIn) return { label: `Interested in ${c.interestedIn}`, tone: "muted" };
  if (c.purchaseStage !== "new") return { label: STAGE_LABEL[c.purchaseStage], tone: "muted" };
  return null;
}
