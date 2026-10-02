import { z } from "zod";

const graphId = z.string().trim().regex(/^\d{5,25}$/, "Must be a numeric Meta ID");

export const embeddedSignupSchema = z.object({
  code: z.string().min(10).max(2000),
  wabaId: graphId,
  phoneNumberId: graphId,
});

export const manualConnectSchema = z.object({
  wabaId: graphId,
  phoneNumberId: graphId,
  accessToken: z.string().trim().min(50, "Paste the full access token").max(2000).regex(/^[A-Za-z0-9_\-|.]+$/, "That doesn't look like a Meta access token"),
});

/** "+234 803 000 0000" -> "2348030000000" (WhatsApp wa_id format). */
export const waIdSchema = z
  .string()
  .transform((v) => v.replace(/[\s()+-]/g, ""))
  .pipe(z.string().regex(/^\d{8,15}$/, "Enter the full number with country code, e.g. +234 803 000 0000"));

export const testMessageSchema = z.object({
  accountId: z.uuid(),
  to: waIdSchema,
});
