import { describe, expect, it } from "vitest";

import { signPaystackPayload, verifyPaystackSignature } from "@/lib/paystack/signature";

const KEY = "sk_test_abcdefghijklmnopqrstuvwxyz123456";

describe("Paystack webhook signature", () => {
  const raw = JSON.stringify({ event: "charge.success", data: { reference: "sf-1001-abc", amount: 4900000 } });

  it("accepts HMAC-SHA512 of the raw body with the secret key", () => {
    expect(verifyPaystackSignature(raw, signPaystackPayload(raw, KEY), KEY)).toBe(true);
  });

  it("rejects tampering, other keys, and malformed headers", () => {
    const sig = signPaystackPayload(raw, KEY);
    expect(verifyPaystackSignature(raw.replace("4900000", "100"), sig, KEY)).toBe(false);
    expect(verifyPaystackSignature(raw, signPaystackPayload(raw, "sk_test_other"), KEY)).toBe(false);
    expect(verifyPaystackSignature(raw, null, KEY)).toBe(false);
    expect(verifyPaystackSignature(raw, "abc", KEY)).toBe(false);
    expect(verifyPaystackSignature(raw, sig.slice(0, 64), KEY)).toBe(false);
  });
});
