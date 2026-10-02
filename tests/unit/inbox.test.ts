import { describe, expect, it } from "vitest";

import { inboxStatus } from "@/components/conversations/labels";
import { dayLabel, displayName, initials, timeAgo } from "@/lib/format";

const now = new Date("2026-09-27T12:00:00Z");

describe("timeAgo", () => {
  it.each([
    ["2026-09-27T11:59:30Z", "just now"],
    ["2026-09-27T11:58:00Z", "2 min. ago"],
    ["2026-09-27T09:00:00Z", "3 hr. ago"],
    ["2026-09-26T12:00:00Z", "yesterday"],
    ["2026-09-12T12:00:00Z", "12 Sept"],
    ["2025-01-05T12:00:00Z", "5 Jan 2025"],
  ])("%s -> %s", (iso, expected) => {
    expect(timeAgo(iso, now)).toBe(expected);
  });
  it("handles missing values", () => {
    expect(timeAgo(null, now)).toBe("");
  });
});

describe("dayLabel", () => {
  it("labels today and yesterday", () => {
    const local = new Date(2026, 8, 27, 15, 0);
    expect(dayLabel(new Date(2026, 8, 27, 9, 0).toISOString(), local)).toBe("Today");
    expect(dayLabel(new Date(2026, 8, 26, 23, 0).toISOString(), local)).toBe("Yesterday");
  });
});

describe("names", () => {
  it("prefers the merchant-set name, then WhatsApp name, then phone", () => {
    expect(displayName({ name: "Sarah O.", profile_name: "Sarah Okafor", phone: "+234" })).toBe("Sarah O.");
    expect(displayName({ name: null, profile_name: "Sarah Okafor", phone: "+234" })).toBe("Sarah Okafor");
    expect(displayName({ name: null, profile_name: null, phone: "+2348030000000" })).toBe("+2348030000000");
  });
  it("builds initials", () => {
    expect(initials("Sarah Okafor")).toBe("SO");
    expect(initials("+2348030000000")).toBe("#");
  });
});

describe("inboxStatus", () => {
  it("puts urgent states first", () => {
    expect(inboxStatus({ needsAttention: true, purchaseStage: "payment_pending", interestedIn: "Bag" })?.label).toBe("Needs human support");
    expect(inboxStatus({ needsAttention: false, purchaseStage: "payment_pending", interestedIn: "Bag" })?.label).toBe("Payment pending");
    expect(inboxStatus({ needsAttention: false, purchaseStage: "product_question", interestedIn: "Black Bag" })?.label).toBe("Interested in Black Bag");
    expect(inboxStatus({ needsAttention: false, purchaseStage: "new", interestedIn: null })).toBeNull();
  });
});
