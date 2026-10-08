import { describe, expect, it } from "vitest";

import { isDueForAiResume } from "@/services/conversations/auto-resume.service";

const now = new Date("2026-10-08T12:00:00Z");
const waitingSince = (iso: string) => ({ id: "c1", business_id: "b1", last_message_at: iso, last_customer_message_at: iso });

describe("isDueForAiResume", () => {
  it("resumes once the customer has waited the business's limit", () => {
    expect(isDueForAiResume(waitingSince("2026-10-08T11:45:00Z"), 15, [], now)).toBe(true);
    expect(isDueForAiResume(waitingSince("2026-10-08T11:50:00Z"), 15, [], now)).toBe(false);
  });

  it("never resumes when the business chose to wait for the team", () => {
    expect(isDueForAiResume(waitingSince("2026-10-08T06:00:00Z"), 0, [], now)).toBe(false);
  });

  it("doesn't resume when someone replied after the customer", () => {
    const c = { ...waitingSince("2026-10-08T11:00:00Z"), last_message_at: "2026-10-08T11:05:00Z" };
    expect(isDueForAiResume(c, 15, [], now)).toBe(false);
  });

  it("gives a person who just took over the full time to reply", () => {
    const c = waitingSince("2026-10-08T11:00:00Z");
    expect(isDueForAiResume(c, 15, [{ conversation_id: "c1", type: "human_takeover", created_at: "2026-10-08T11:55:00Z" }], now)).toBe(false);
    expect(isDueForAiResume(c, 15, [{ conversation_id: "c1", type: "human_takeover", created_at: "2026-10-08T11:30:00Z" }], now)).toBe(true);
    expect(isDueForAiResume(c, 15, [{ conversation_id: "other", type: "human_takeover", created_at: "2026-10-08T11:55:00Z" }], now)).toBe(true);
  });

  it("doesn't loop when the AI already handed this message over because it couldn't run", () => {
    const c = waitingSince("2026-10-08T11:00:00Z");
    expect(isDueForAiResume(c, 15, [{ conversation_id: "c1", type: "handoff_requested", created_at: "2026-10-08T11:00:05Z" }], now)).toBe(false);
    // An older handoff (before the customer's latest message) doesn't block.
    expect(isDueForAiResume(c, 15, [{ conversation_id: "c1", type: "handoff_requested", created_at: "2026-10-08T10:00:00Z" }], now)).toBe(true);
  });
});
