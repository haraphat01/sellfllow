import { describe, expect, it } from "vitest";

import { describeCommission, isValidAccountNumber, platformFeeMinor } from "@/services/payments/payouts.core";
import { platformSettingsSchema } from "@/lib/validation/admin";

describe("platformFeeMinor", () => {
  it("is zero when no commission is configured", () => {
    expect(platformFeeMinor(4_900_000, { percent: 0, flatMinor: 0 })).toBe(0);
  });
  it("combines percent and flat fee, rounded to the kobo", () => {
    expect(platformFeeMinor(4_900_000, { percent: 2, flatMinor: 10_000 })).toBe(108_000); // 2% of ₦49,000 + ₦100
    expect(platformFeeMinor(333_333, { percent: 1.5, flatMinor: 0 })).toBe(5_000);
  });
  it("never takes the whole sale", () => {
    expect(platformFeeMinor(10_000, { percent: 0, flatMinor: 50_000 })).toBe(9_900);
    expect(platformFeeMinor(0, { percent: 5, flatMinor: 100 })).toBe(0);
  });
});

describe("account numbers and display", () => {
  it("accepts exactly 10 digits (NUBAN)", () => {
    expect(isValidAccountNumber("0123456789")).toBe(true);
    expect(["012345678", "01234567890", "01234abc89", ""].some(isValidAccountNumber)).toBe(false);
  });
  it("describes the fee for merchants", () => {
    expect(describeCommission({ percent: 0, flatMinor: 0 })).toBe("no SellFlow fee");
    expect(describeCommission({ percent: 1.5, flatMinor: 10_000 })).toBe("1.5% + ₦100 per sale");
  });
});

describe("admin commission settings", () => {
  it("bounds the percent and parses the flat fee in naira", () => {
    expect(platformSettingsSchema.safeParse({ trial_days: 14, commission_percent: 25, commission_flat: "" }).success).toBe(false);
    const ok = platformSettingsSchema.safeParse({ trial_days: 14, commission_percent: "1.5", commission_flat: "100" });
    expect(ok.success && ok.data).toEqual({ trial_days: 14, commission_percent: 1.5, commission_flat: 10_000 });
    expect(platformSettingsSchema.safeParse({ trial_days: 14, commission_percent: 0, commission_flat: "10000" }).success).toBe(false);
  });
});
