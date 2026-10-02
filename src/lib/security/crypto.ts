import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { requireServerEnv } from "@/lib/env/server";

/**
 * AES-256-GCM envelope for third-party credentials stored in
 * business_credentials. Format: v1:<iv b64>:<tag b64>:<ciphertext b64>.
 * Key: CREDENTIALS_ENCRYPTION_KEY = 32 random bytes, base64.
 */
const VERSION = "v1";

function key(): Buffer {
  const k = Buffer.from(requireServerEnv("CREDENTIALS_ENCRYPTION_KEY"), "base64");
  if (k.length !== 32) throw new Error("CREDENTIALS_ENCRYPTION_KEY must be 32 bytes (base64-encoded)");
  return k;
}

export function encryptSecret(plaintext: string, aad?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(payload: string, aad?: string): string {
  const [version, iv, tag, data] = payload.split(":");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Unsupported credential format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
