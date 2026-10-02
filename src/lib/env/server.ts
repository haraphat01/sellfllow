import "server-only";

import { z } from "zod";

/**
 * Server-only secrets. Integration secrets are optional at boot so the app can
 * run before Meta/Paystack/AI are configured; each integration calls
 * `requireServerEnv()` for the keys it needs and fails loudly if missing.
 */
const schema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  CREDENTIALS_ENCRYPTION_KEY: z.string().optional(),

  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_VERIFY_TOKEN: z.string().optional(),
  META_CONFIG_ID: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v25.0"),
  /** Test-only: point the Graph client at a local mock. Ignored in production. */
  META_GRAPH_BASE_URL: z.url().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),

  PAYSTACK_SECRET_KEY: z.string().optional(),
  /** Test-only: point the Paystack client at a local mock. Ignored in production. */
  PAYSTACK_BASE_URL: z.url().optional(),
  /** Paystack requires an email; customers without one get <wa_id>@<this domain>. */
  PAYSTACK_PLACEHOLDER_EMAIL_DOMAIN: z.string().default("customers.sellflow.app"),

  AI_GATEWAY_API_KEY: z.string().optional(),
  AI_DEFAULT_MODEL: z.string().default("anthropic/claude-sonnet-5"),
  /** Direct DeepSeek API (models "deepseek/<id>"); everything else goes through AI Gateway. */
  DEEPSEEK_API_KEY: z.string().optional(),

  // Shared secret for /api/cron/* (Coolify scheduled tasks).
  CRON_SECRET: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (!cached) {
    cached = schema.parse({
      ...process.env,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY,
      AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY ?? process.env.AI_PROVIDER_API_KEY,
    });
  }
  return cached;
}

export function requireServerEnv<K extends keyof ServerEnv>(key: K): NonNullable<ServerEnv[K]> {
  const value = serverEnv()[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable: ${String(key)}`);
  }
  return value as NonNullable<ServerEnv[K]>;
}

/** Credentials exist for this model's provider (DeepSeek direct, or AI Gateway key / Vercel OIDC). */
export function isModelAvailable(modelId: string) {
  if (modelId.startsWith("deepseek/")) return Boolean(serverEnv().DEEPSEEK_API_KEY);
  return Boolean(serverEnv().AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}

/** At least one AI provider is configured. */
export function isAiConfigured() {
  return Boolean(serverEnv().DEEPSEEK_API_KEY || serverEnv().AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}
