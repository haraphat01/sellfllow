import { describe, expect, it } from "vitest";

import { checkPriceGrounding, collectGroundedAmounts, extractAmountsMinor } from "@/services/ai/grounding";

describe("extractAmountsMinor", () => {
  it.each([
    ["The bag is ₦45,000.", [4_500_000]],
    ["Total: NGN 48,000", [4_800_000]],
    ["only N12,500 today", [1_250_000]],
    ["That's 45,000 naira", [4_500_000]],
    ["about 45k naira", [4_500_000]],
    ["₦45,000.50", [4_500_050]],
    ["We have 20 in stock and it's size 42", []],
    ["Order #1042 is on its way", []],
    ["$12.50 shipping", [1250]],
    // Regression: ordinary words must not read as currency codes (found with a real model).
    ["the fee is ₦3,000 and it takes 1-2 days", [300_000]],
    ["it makes 2 sizes, available for 2 weeks in 3 colours", []],
    ["Room 4, Floor 2", []],
    ["We ship to Nairobi in 5 days", []],
    ["Pay here: https://checkout.paystack.com/N5x2abc?amount=R100 — total ₦49,000", [4_900_000]],
  ])("%s", (text, expected) => {
    expect(extractAmountsMinor(text)).toEqual(expected);
  });
});

describe("checkPriceGrounding", () => {
  const toolOutputs = [
    { products: [{ name: "Black Leather Bag", price_minor: 4_500_000 }] },
    { delivery_zones: [{ name: "Lagos Mainland", fee_minor: 300_000 }] },
  ];
  const grounded = collectGroundedAmounts(toolOutputs);

  it("passes when every amount came from tools", () => {
    expect(checkPriceGrounding("The Black Leather Bag is ₦45,000 and delivery to Lagos Mainland is ₦3,000.", grounded)).toEqual({ ok: true });
  });

  it("allows totals (item + delivery) and quantity multiples", () => {
    expect(checkPriceGrounding("Total ₦48,000", grounded).ok).toBe(true);
    expect(checkPriceGrounding("Two bags come to ₦90,000", grounded).ok).toBe(true);
  });

  it("blocks invented prices and discounts", () => {
    expect(checkPriceGrounding("The red bag is ₦38,000", grounded)).toEqual({ ok: false, ungrounded: [3_800_000] });
    expect(checkPriceGrounding("I can do it for ₦40,000 for you", grounded).ok).toBe(false);
  });

  it("passes the real reply that was wrongly blocked", () => {
    const reply = "The *Black Leather Bag* is ₦46,000 and it's in stock. Yes, we deliver to Lagos Mainland — the fee is ₦3,000 and it takes 1-2 days.";
    expect(checkPriceGrounding(reply, collectGroundedAmounts([{ price_minor: 4_600_000 }, { fee_minor: 300_000 }]))).toEqual({ ok: true });
  });

  it("passes replies with no amounts", () => {
    expect(checkPriceGrounding("Yes, we have it in black.", new Set()).ok).toBe(true);
  });
});
