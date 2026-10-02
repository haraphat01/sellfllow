import { describe, expect, it } from "vitest";

import { nextSendTime, renderFollowUp } from "@/services/automation/follow-ups.core";
import { optKeyword } from "@/services/whatsapp/inbound.service";
import { followUpSettingsFromForm } from "@/lib/validation/follow-ups";

describe("renderFollowUp", () => {
  it("uses the default product message with the customer's first name", () => {
    expect(renderFollowUp({ kind: "product", productName: "Black Leather Bag", customerFirstName: "Sarah" }, null)).toBe(
      "Hi Sarah 👋 Just checking in about the Black Leather Bag you asked about — it's still available. Would you like me to help you complete your order?",
    );
  });

  it("uses the merchant's message and fills placeholders", () => {
    expect(renderFollowUp({ kind: "product", productName: "Sneakers", customerFirstName: "" }, "Hey {name}, the {product} is waiting for you!")).toBe(
      "Hey there, the Sneakers is waiting for you!",
    );
  });

  it("never mentions a product when none is known", () => {
    const text = renderFollowUp({ kind: "general", customerFirstName: "Ada" }, "Hi {name}, the {product} is still in stock!");
    expect(text).toBe("Hi Ada 👋 Just checking in — would you like me to help you complete your order?");
    expect(renderFollowUp({ kind: "general", customerFirstName: "Ada" }, "Hi {name}, still thinking about it?")).toBe("Hi Ada, still thinking about it?");
  });

  it("reminds about an unpaid order with its payment link", () => {
    expect(
      renderFollowUp({ kind: "pending_order", orderNumber: 1033, total: "₦49,000", paymentLink: "https://checkout.paystack.com/x", customerFirstName: "Ngozi" }, "ignored {product}"),
    ).toBe("Hi Ngozi 👋 Your order #1033 (₦49,000) is still waiting for payment. You can complete payment here: https://checkout.paystack.com/x");
    expect(renderFollowUp({ kind: "pending_order", orderNumber: 7, total: "₦1", paymentLink: null, customerFirstName: "" }, null)).toContain(
      "Reply here and I'll send you a payment link.",
    );
  });
});

describe("nextSendTime (Africa/Lagos, UTC+1, window 09–20)", () => {
  const tz = "Africa/Lagos";
  it("sends immediately inside the window", () => {
    const now = new Date("2026-09-28T10:00:00Z"); // 11:00 Lagos
    expect(nextSendTime(now, tz, 9, 20)).toEqual(now);
  });
  it("waits for the window to open in the morning", () => {
    expect(nextSendTime(new Date("2026-09-28T05:30:00Z"), tz, 9, 20).toISOString()).toBe("2026-09-28T08:00:00.000Z");
  });
  it("moves to the next morning after the window closes", () => {
    expect(nextSendTime(new Date("2026-09-28T19:00:00Z"), tz, 9, 20).toISOString()).toBe("2026-09-29T08:00:00.000Z"); // 20:00 Lagos
    expect(nextSendTime(new Date("2026-09-30T23:30:00Z"), tz, 9, 20).toISOString()).toBe("2026-10-01T08:00:00.000Z"); // month rollover
  });
  it("handles DST zones and bad zone names", () => {
    // London is UTC+1 in September: 07:00 local → 08:00 UTC
    expect(nextSendTime(new Date("2026-09-28T05:00:00Z"), "Europe/London", 9, 20).toISOString()).toBe("2026-09-28T08:00:00.000Z");
    expect(nextSendTime(new Date("2026-09-28T05:00:00Z"), "Not/AZone", 9, 20).toISOString()).toBe("2026-09-28T09:00:00.000Z");
  });
});

describe("optKeyword", () => {
  it.each(["STOP", "stop", " Stop. ", "unsubscribe", "opt out", "Opt-out", "STOP ALL"])("%s opts out", (t) => expect(optKeyword(t)).toBe("opt_out"));
  it.each(["START", "start!", "subscribe", "opt in"])("%s opts in", (t) => expect(optKeyword(t)).toBe("opt_in"));
  it.each(["please stop", "stop the order", "how much?", "", null])("%s is not a keyword", (t) => expect(optKeyword(t)).toBeNull());
});

describe("follow-up settings validation", () => {
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    const base = { delay_value: "4", delay_unit: "hours", max: "2", message: "", window_start: "9", window_end: "20", template_name: "", template_language: "en", attribution_window_hours: "72" };
    Object.entries({ ...base, ...o }).forEach(([k, v]) => f.set(k, v));
    return f;
  };
  it("converts the delay to minutes", () => {
    const r = followUpSettingsFromForm(form({ enabled: "on" }));
    expect(r.success && r.data).toMatchObject({ enabled: true, delay_minutes: 240, max: 2, respect_hours: false, message: null });
  });
  it("rejects delays outside 15 minutes – 7 days and reversed windows", () => {
    expect(followUpSettingsFromForm(form({ delay_value: "10", delay_unit: "minutes" })).success).toBe(false);
    expect(followUpSettingsFromForm(form({ delay_value: "8", delay_unit: "days" })).success).toBe(false);
    expect(followUpSettingsFromForm(form({ window_start: "20", window_end: "9" })).success).toBe(false);
  });
  it("rejects unknown placeholders and bad template names", () => {
    expect(followUpSettingsFromForm(form({ message: "Hi {first_name}" })).success).toBe(false);
    expect(followUpSettingsFromForm(form({ template_name: "Bad Name!" })).success).toBe(false);
    expect(followUpSettingsFromForm(form({ template_name: "cart_reminder" })).success).toBe(true);
  });
});
