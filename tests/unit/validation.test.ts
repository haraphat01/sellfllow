import { describe, expect, it } from "vitest";

import { formatMoney } from "@/lib/money";
import { businessProfileSchema } from "@/lib/validation/business";

describe("businessProfileSchema", () => {
  const valid = { name: "Aisha Fashion", industry: "Fashion & apparel" };

  it("accepts a minimal profile and applies defaults", () => {
    const r = businessProfileSchema.parse(valid);
    expect(r.country).toBe("NG");
    expect(r.currency).toBe("NGN");
    expect(r.timezone).toBe("Africa/Lagos");
  });

  it("normalises empty optional strings to null", () => {
    const r = businessProfileSchema.parse({ ...valid, phone: "", website: "" });
    expect(r.phone).toBeNull();
    expect(r.website).toBeNull();
  });

  it("rejects bad input", () => {
    expect(businessProfileSchema.safeParse({ ...valid, name: "A" }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ ...valid, industry: "Weapons" }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ ...valid, website: "javascript:alert(1)" }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ ...valid, phone: "call me" }).success).toBe(false);
  });
});

describe("formatMoney", () => {
  it("formats kobo as naira", () => {
    expect(formatMoney(4_500_000, "NGN")).toMatch(/45,000/);
    expect(formatMoney(4_800_050, "NGN")).toMatch(/48,000\.50/);
  });
});
