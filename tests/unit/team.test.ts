import { describe, expect, it } from "vitest";

import { inviteSchema, memberAccessSchema } from "@/lib/validation/team";

describe("memberAccessSchema", () => {
  it("clears permissions for admins", () => {
    expect(memberAccessSchema.parse({ role: "admin", permissions: ["orders.view"] }).permissions).toEqual([]);
  });

  it("requires at least one permission for staff and dedupes", () => {
    expect(memberAccessSchema.safeParse({ role: "staff", permissions: [] }).success).toBe(false);
    expect(memberAccessSchema.parse({ role: "staff", permissions: ["orders.view", "orders.view"] }).permissions).toEqual(["orders.view"]);
  });

  it("rejects owner role and unknown permissions", () => {
    expect(memberAccessSchema.safeParse({ role: "owner", permissions: [] }).success).toBe(false);
    expect(memberAccessSchema.safeParse({ role: "staff", permissions: ["root"] }).success).toBe(false);
  });
});

describe("inviteSchema", () => {
  it("normalises email", () => {
    const r = inviteSchema.parse({ email: "  Staff@Example.COM ", role: "staff", permissions: ["conversations.view"] });
    expect(r.email).toBe("staff@example.com");
  });
});
