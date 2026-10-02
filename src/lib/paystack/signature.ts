import { createHmac, timingSafeEqual } from "node:crypto";

/** Paystack signs webhooks with x-paystack-signature = hex(HMAC-SHA512(rawBody, secretKey)). */
export function verifyPaystackSignature(rawBody: string, header: string | null, secretKey: string): boolean {
  if (!header || !secretKey || !/^[0-9a-f]{128}$/i.test(header)) return false;
  const expected = createHmac("sha512", secretKey).update(rawBody).digest();
  const given = Buffer.from(header, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function signPaystackPayload(rawBody: string, secretKey: string) {
  return createHmac("sha512", secretKey).update(rawBody).digest("hex");
}
