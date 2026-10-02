import "server-only";

import { createHash, randomBytes } from "node:crypto";

/** URL-safe random secret (e.g. invitation tokens). Only the hash is stored. */
export function generateToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
