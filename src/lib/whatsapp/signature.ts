import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies Meta's X-Hub-Signature-256 header: "sha256=" + hex(HMAC-SHA256(rawBody, appSecret)).
 * Must be computed over the exact raw request bytes, before JSON parsing.
 */
export function verifyMetaSignature(rawBody: string | Buffer, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const [scheme, received] = header.split("=", 2);
  if (scheme !== "sha256" || !received || !/^[0-9a-f]{64}$/i.test(received)) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(received, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function signMetaPayload(rawBody: string, appSecret: string) {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}
