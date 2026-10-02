/** Realistic Meta WhatsApp Cloud API webhook payloads (shape per Meta docs). */
export const PHONE_NUMBER_ID = "106540352242922";
export const WABA_ID = "102290129340398";

export function textMessagePayload(opts: { id?: string; from?: string; body?: string; phoneNumberId?: string; name?: string; ts?: number } = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: WABA_ID,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550783881", phone_number_id: opts.phoneNumberId ?? PHONE_NUMBER_ID },
              contacts: [{ profile: { name: opts.name ?? "Sarah" }, wa_id: opts.from ?? "2348030000001" }],
              messages: [
                {
                  from: opts.from ?? "2348030000001",
                  id: opts.id ?? "wamid.HBgNMjM0ODAzMDAwMDAwMRUCABIYFjNFQjBDNkQ1RTc4RjM1QjU0N0Y4AA==",
                  timestamp: String(opts.ts ?? 1790000000),
                  type: "text",
                  text: { body: opts.body ?? "Hi, how much is the black bag?" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function statusPayload(opts: { id: string; status: "sent" | "delivered" | "read" | "failed"; phoneNumberId?: string; ts?: number }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: WABA_ID,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550783881", phone_number_id: opts.phoneNumberId ?? PHONE_NUMBER_ID },
              statuses: [
                {
                  id: opts.id,
                  status: opts.status,
                  timestamp: String(opts.ts ?? 1790000100),
                  recipient_id: "2348030000001",
                  ...(opts.status === "failed" ? { errors: [{ code: 131047, title: "Re-engagement message" }] } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
