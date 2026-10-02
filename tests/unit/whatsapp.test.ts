import { describe, expect, it } from "vitest";

import { embeddedSignupSchema, manualConnectSchema, waIdSchema } from "@/lib/validation/whatsapp";
import { signMetaPayload, verifyMetaSignature } from "@/lib/whatsapp/signature";
import { templateNeedsNoParameters } from "@/lib/whatsapp/graph";
import { extractEvents, nextMessageStatus } from "@/lib/whatsapp/webhook";
import { isWithinServiceWindow } from "@/services/whatsapp/outbound.service";

import { PHONE_NUMBER_ID, statusPayload, textMessagePayload } from "../fixtures/whatsapp";

const SECRET = "test-app-secret";

describe("verifyMetaSignature", () => {
  const raw = JSON.stringify(textMessagePayload());

  it("accepts a correct signature over the raw body", () => {
    expect(verifyMetaSignature(raw, signMetaPayload(raw, SECRET), SECRET)).toBe(true);
  });

  it("rejects tampering, wrong secret, missing or malformed headers", () => {
    const sig = signMetaPayload(raw, SECRET);
    expect(verifyMetaSignature(raw.replace("black", "white"), sig, SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, signMetaPayload(raw, "other"), SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, null, SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, "sha1=abc", SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, "sha256=zz", SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, sig, "")).toBe(false);
  });

  it("is sensitive to re-serialisation (must use the raw body)", () => {
    const reserialised = JSON.stringify(JSON.parse(raw), null, 2);
    expect(verifyMetaSignature(reserialised, signMetaPayload(raw, SECRET), SECRET)).toBe(false);
  });
});

describe("extractEvents", () => {
  it("normalises an inbound text message", () => {
    const { events } = extractEvents(textMessagePayload({ id: "wamid.A", ts: 1790000000 }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "message",
      eventKey: "msg:wamid.A",
      phoneNumberId: PHONE_NUMBER_ID,
      from: "2348030000001",
      profileName: "Sarah",
      type: "text",
      body: "Hi, how much is the black bag?",
    });
    expect(events[0].kind === "message" && events[0].sentAt.toISOString()).toBe(new Date(1790000000 * 1000).toISOString());
  });

  it("derives text for non-text message types", () => {
    const p = textMessagePayload();
    const msgs = p.entry[0].changes[0].value.messages as Record<string, unknown>[];
    msgs.splice(0, 1,
      { from: "2348030000001", id: "w1", timestamp: "1", type: "image", image: { id: "m1", caption: "This one?" } },
      { from: "2348030000001", id: "w2", timestamp: "1", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "yes", title: "Yes, order" } } },
      { from: "2348030000001", id: "w3", timestamp: "1", type: "audio", audio: { id: "m2" } },
      { from: "2348030000001", id: "w4", timestamp: "1", type: "button", button: { text: "Stop promotions", payload: "STOP" } },
    );
    const bodies = extractEvents(p).events.map((e) => e.kind === "message" && e.body);
    expect(bodies).toEqual(["This one?", "Yes, order", null, "Stop promotions"]);
  });

  it("normalises statuses with idempotency keys per status", () => {
    const { events } = extractEvents(statusPayload({ id: "wamid.OUT", status: "failed" }));
    expect(events[0]).toMatchObject({ kind: "status", eventKey: "status:wamid.OUT:failed", status: "failed", error: "131047: Re-engagement message" });
  });

  it("skips malformed items without dropping valid ones", () => {
    const p = textMessagePayload();
    (p.entry[0].changes[0].value.messages as unknown[]).push({ from: "not-a-number", id: "x", timestamp: "1", type: "text" });
    const r = extractEvents(p);
    expect(r.events).toHaveLength(1);
    expect(r.skipped).toBe(1);
  });

  it("ignores other objects and non-message fields", () => {
    expect(extractEvents({ object: "page", entry: [] }).events).toEqual([]);
    expect(extractEvents({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "account_update", value: {} }] }] }).fields).toEqual(["account_update"]);
    expect(extractEvents("garbage").events).toEqual([]);
  });
});

describe("nextMessageStatus", () => {
  it("only moves forward", () => {
    expect(nextMessageStatus("queued", "sent")).toBe("sent");
    expect(nextMessageStatus("sent", "read")).toBe("read");
    expect(nextMessageStatus("read", "delivered")).toBeNull();
    expect(nextMessageStatus("delivered", "delivered")).toBeNull();
  });
  it("failed is terminal", () => {
    expect(nextMessageStatus("sent", "failed")).toBe("failed");
    expect(nextMessageStatus("failed", "read")).toBeNull();
  });
});

describe("24-hour service window", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  it("is open within 24h of the customer's last message", () => {
    expect(isWithinServiceWindow("2026-09-26T12:00:01Z", now)).toBe(true);
    expect(isWithinServiceWindow("2026-09-26T11:59:59Z", now)).toBe(false);
    expect(isWithinServiceWindow(null, now)).toBe(false);
  });
});

describe("whatsapp input validation", () => {
  it("normalises phone numbers to wa_id", () => {
    expect(waIdSchema.parse("+234 803 000 0000")).toBe("2348030000000");
    expect(waIdSchema.safeParse("0803").success).toBe(false);
    expect(waIdSchema.safeParse("+234abc").success).toBe(false);
  });
  it("requires numeric Meta ids", () => {
    expect(embeddedSignupSchema.safeParse({ code: "x".repeat(20), wabaId: "123456", phoneNumberId: "../../me" }).success).toBe(false);
    expect(manualConnectSchema.safeParse({ wabaId: "123456", phoneNumberId: "654321", accessToken: "short" }).success).toBe(false);
  });
});

describe("templateNeedsNoParameters", () => {
  const t = (components: unknown[]) => ({ name: "x", language: "en", status: "APPROVED", components }) as Parameters<typeof templateNeedsNoParameters>[0];
  it("accepts plain-text templates", () => {
    expect(templateNeedsNoParameters(t([{ type: "BODY", text: "Hello! Thanks for contacting us." }]))).toBe(true);
    expect(templateNeedsNoParameters(t([{ type: "HEADER", format: "TEXT", text: "Hi" }, { type: "BODY", text: "Welcome" }, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Yes" }] }]))).toBe(true);
  });
  it("rejects templates that need variables or media", () => {
    expect(templateNeedsNoParameters(t([{ type: "BODY", text: "Hi {{1}}, your order is ready" }]))).toBe(false);
    expect(templateNeedsNoParameters(t([{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Sale!" }]))).toBe(false);
    expect(templateNeedsNoParameters(t([{ type: "BODY", text: "Pay now" }, { type: "BUTTONS", buttons: [{ type: "URL", url: "https://x.com/{{1}}" }] }]))).toBe(false);
  });
});
