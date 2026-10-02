import { describe, expect, it } from "vitest";

import { collectGroundedAmounts, checkPriceGrounding, extractAmountsMinor } from "@/services/ai/grounding";
import { faqSchema, parseKeywords } from "@/lib/validation/faqs";

describe("Q&A input", () => {
  it("parses keywords: comma or newline separated, trimmed, lower-case, unique, max 20", () => {
    expect(parseKeywords(" Pickup, collect,\nPICKUP ,, waybill ")).toEqual(["pickup", "collect", "waybill"]);
    expect(parseKeywords(Array.from({ length: 30 }, (_, i) => `k${i}`).join(","))).toHaveLength(20);
  });
  it("requires a real question and an answer", () => {
    expect(faqSchema.safeParse({ question: "Hi", answer: "x", keywords: [], isActive: true }).success).toBe(false);
    expect(faqSchema.safeParse({ question: "Do you deliver?", answer: "", keywords: [], isActive: true }).success).toBe(false);
    expect(faqSchema.safeParse({ question: "Do you deliver?", answer: "Yes, nationwide.", keywords: ["waybill"], isActive: true }).success).toBe(true);
  });
});

describe("prices written in Q&A answers are grounded", () => {
  it("lets the AI quote an amount from an answer, but not a different one", () => {
    const toolOutput = { found: true, answers: [{ question: "Do you deliver to Ilorin?", answer: "Yes, ₦2,000 within 2 days.", amounts_minor: extractAmountsMinor("Yes, ₦2,000 within 2 days.") }] };
    const grounded = collectGroundedAmounts([toolOutput]);
    expect(checkPriceGrounding("Yes! Delivery to Ilorin is ₦2,000.", grounded)).toEqual({ ok: true });
    expect(checkPriceGrounding("Yes! Delivery to Ilorin is ₦2,500.", grounded).ok).toBe(false);
  });
});
