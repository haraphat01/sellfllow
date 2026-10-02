import { Inngest } from "inngest";

/**
 * Background jobs. Locally, run the Inngest dev server (`npm run inngest:dev`)
 * and set INNGEST_DEV=1; in production the Vercel Inngest integration sets
 * INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY.
 */
export const inngest = new Inngest({ id: "sellflow" });

export const EVENTS = {
  whatsappEventReceived: "whatsapp/event.received",
  conversationMessageReceived: "conversation/message.received",
  paymentSucceeded: "payment/succeeded",
  paymentForUnpayableOrder: "payment/unpayable-order",
  followUpDue: "follow-up/due",
} as const;
