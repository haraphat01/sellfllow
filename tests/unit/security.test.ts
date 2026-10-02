import { randomBytes } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { hasPermission } from "@/lib/auth/permissions";
import { safeNextPath } from "@/lib/security/redirect";

describe("safeNextPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/orders?status=paid", "/orders?status=paid"],
    ["//evil.com", "/dashboard"],
    ["/\\evil.com", "/dashboard"],
    ["https://evil.com", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
    [null, "/dashboard"],
  ])("%s -> %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe("hasPermission", () => {
  it("owners and admins hold every permission", () => {
    expect(hasPermission("owner", [], "billing.manage")).toBe(true);
    expect(hasPermission("admin", [], "staff.manage")).toBe(true);
  });
  it("staff only hold granted permissions", () => {
    expect(hasPermission("staff", ["conversations.view"], "conversations.view")).toBe(true);
    expect(hasPermission("staff", ["conversations.view"], "orders.manage")).toBe(false);
  });
});

describe("credential encryption", () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "x".repeat(40);
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("round-trips and binds to the associated data", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/security/crypto");
    const token = "EAAG-secret-whatsapp-token";
    const enc = encryptSecret(token, "business-a");

    expect(enc).not.toContain(token);
    expect(decryptSecret(enc, "business-a")).toBe(token);
    // A ciphertext copied to another tenant's row must not decrypt.
    expect(() => decryptSecret(enc, "business-b")).toThrow();
  });

  it("detects tampering", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/security/crypto");
    const [v, iv, tag, data] = encryptSecret("secret").split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64")].join(":"))).toThrow();
  });
});
