import { z } from "zod";

/**
 * Meta WhatsApp Cloud API webhook payloads, normalised into one event per
 * inbound message / status update. Unknown fields are preserved in `raw`.
 */

const messageSchema = z
  .object({
    from: z.string().regex(/^\d{6,20}$/),
    id: z.string().min(1).max(200),
    timestamp: z.string().regex(/^\d+$/),
    type: z.string(),
    text: z.object({ body: z.string() }).optional(),
    image: z.object({ caption: z.string().optional() }).loose().optional(),
    video: z.object({ caption: z.string().optional() }).loose().optional(),
    document: z.object({ caption: z.string().optional(), filename: z.string().optional() }).loose().optional(),
    button: z.object({ text: z.string().optional(), payload: z.string().optional() }).loose().optional(),
    interactive: z
      .object({
        type: z.string(),
        button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
        list_reply: z.object({ id: z.string(), title: z.string(), description: z.string().optional() }).optional(),
      })
      .loose()
      .optional(),
    reaction: z.object({ message_id: z.string().optional(), emoji: z.string().optional() }).loose().optional(),
    location: z.object({ latitude: z.number(), longitude: z.number(), name: z.string().optional(), address: z.string().optional() }).loose().optional(),
    context: z.object({ id: z.string().optional(), from: z.string().optional() }).loose().optional(),
  })
  .loose();

const statusSchema = z
  .object({
    id: z.string().min(1).max(200),
    status: z.enum(["sent", "delivered", "read", "failed", "deleted"]),
    timestamp: z.string().regex(/^\d+$/),
    recipient_id: z.string().optional(),
    errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional(), message: z.string().optional() }).loose()).optional(),
  })
  .loose();

const valueSchema = z
  .object({
    messaging_product: z.literal("whatsapp").optional(),
    metadata: z.object({ display_phone_number: z.string().optional(), phone_number_id: z.string().min(1) }).optional(),
    contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().optional() }).optional() }).loose()).optional(),
    messages: z.array(z.unknown()).optional(),
    statuses: z.array(z.unknown()).optional(),
  })
  .loose();

export const webhookPayloadSchema = z.object({
  object: z.string(),
  entry: z
    .array(
      z.object({
        id: z.string(),
        changes: z.array(z.object({ field: z.string(), value: z.unknown() })).default([]),
      }),
    )
    .default([]),
});

export type InboundMessageEvent = {
  kind: "message";
  eventKey: string;
  wabaId: string;
  phoneNumberId: string;
  waMessageId: string;
  from: string;
  profileName: string | null;
  sentAt: Date;
  type: string;
  body: string | null;
  replyToWaMessageId: string | null;
  raw: Record<string, unknown>;
};

export type StatusEvent = {
  kind: "status";
  eventKey: string;
  wabaId: string;
  phoneNumberId: string;
  waMessageId: string;
  status: "sent" | "delivered" | "read" | "failed" | "deleted";
  at: Date;
  recipient: string | null;
  error: string | null;
  raw: Record<string, unknown>;
};

export type WhatsAppEvent = InboundMessageEvent | StatusEvent;

/** Human-readable text for any inbound message type (used for previews and the AI). */
export function messageText(m: z.infer<typeof messageSchema>): string | null {
  switch (m.type) {
    case "text":
      return m.text?.body ?? null;
    case "image":
    case "video":
      return m[m.type]?.caption ?? null;
    case "document":
      return m.document?.caption ?? m.document?.filename ?? null;
    case "button":
      return m.button?.text ?? m.button?.payload ?? null;
    case "interactive":
      return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
    case "reaction":
      return m.reaction?.emoji ?? null;
    case "location":
      return [m.location?.name, m.location?.address].filter(Boolean).join(", ") || "Shared a location";
    default:
      return null;
  }
}

/**
 * Flattens a verified webhook payload into events. Invalid individual items
 * are skipped (and reported) rather than failing the whole delivery.
 */
export function extractEvents(payload: unknown): { events: WhatsAppEvent[]; skipped: number; fields: string[] } {
  const parsed = webhookPayloadSchema.safeParse(payload);
  if (!parsed.success || parsed.data.object !== "whatsapp_business_account") return { events: [], skipped: 0, fields: [] };

  const events: WhatsAppEvent[] = [];
  const fields: string[] = [];
  let skipped = 0;

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      fields.push(change.field);
      if (change.field !== "messages") continue;
      const value = valueSchema.safeParse(change.value);
      if (!value.success || !value.data.metadata) {
        skipped++;
        continue;
      }
      const phoneNumberId = value.data.metadata.phone_number_id;
      const names = new Map((value.data.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]));

      for (const rawMessage of value.data.messages ?? []) {
        const m = messageSchema.safeParse(rawMessage);
        if (!m.success) {
          skipped++;
          continue;
        }
        events.push({
          kind: "message",
          eventKey: `msg:${m.data.id}`,
          wabaId: entry.id,
          phoneNumberId,
          waMessageId: m.data.id,
          from: m.data.from,
          profileName: names.get(m.data.from) ?? null,
          sentAt: new Date(Number(m.data.timestamp) * 1000),
          type: m.data.type,
          body: messageText(m.data),
          replyToWaMessageId: m.data.context?.id ?? null,
          raw: rawMessage as Record<string, unknown>,
        });
      }

      for (const rawStatus of value.data.statuses ?? []) {
        const s = statusSchema.safeParse(rawStatus);
        if (!s.success) {
          skipped++;
          continue;
        }
        const err = s.data.errors?.[0];
        events.push({
          kind: "status",
          eventKey: `status:${s.data.id}:${s.data.status}`,
          wabaId: entry.id,
          phoneNumberId,
          waMessageId: s.data.id,
          status: s.data.status,
          at: new Date(Number(s.data.timestamp) * 1000),
          recipient: s.data.recipient_id ?? null,
          error: err ? [err.code, err.title ?? err.message].filter(Boolean).join(": ") : null,
          raw: rawStatus as Record<string, unknown>,
        });
      }
    }
  }
  return { events, skipped, fields };
}

const STATUS_RANK = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 } as const;

/**
 * Meta can deliver status webhooks out of order. Only move forward
 * (queued → sent → delivered → read); failed wins over anything.
 */
export function nextMessageStatus(current: string, incoming: "sent" | "delivered" | "read" | "failed"): string | null {
  if (current === "failed") return null;
  if (incoming === "failed") return "failed";
  const cur = STATUS_RANK[current as keyof typeof STATUS_RANK] ?? 0;
  return STATUS_RANK[incoming] > cur ? incoming : null;
}
