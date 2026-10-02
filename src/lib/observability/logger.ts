import "server-only";

/**
 * Structured JSON logger. Every important operation should carry the trace
 * fields below so a request can be followed across webhook -> AI -> WhatsApp.
 */
export type LogContext = {
  request_id?: string;
  business_id?: string;
  whatsapp_account_id?: string;
  conversation_id?: string;
  message_id?: string;
  ai_request_id?: string;
  webhook_event_id?: string;
  [key: string]: unknown;
};

type Level = "debug" | "info" | "warn" | "error";

const REDACT = /(token|secret|password|authorization|api_key|apikey|ciphertext)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, REDACT.test(k) ? "[redacted]" : redact(v, depth + 1)]),
  );
}

function emit(level: Level, msg: string, ctx: LogContext = {}, err?: unknown) {
  const entry: Record<string, unknown> = {
    level,
    msg,
    time: new Date().toISOString(),
    ...(redact(ctx) as LogContext),
  };
  if (err instanceof Error) {
    entry.error = { name: err.name, message: err.message, stack: err.stack };
  } else if (err !== undefined) {
    entry.error = err;
  }
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(base: LogContext = {}) {
  return {
    child: (ctx: LogContext) => createLogger({ ...base, ...ctx }),
    debug: (msg: string, ctx?: LogContext) => process.env.NODE_ENV !== "production" && emit("debug", msg, { ...base, ...ctx }),
    info: (msg: string, ctx?: LogContext) => emit("info", msg, { ...base, ...ctx }),
    warn: (msg: string, ctx?: LogContext) => emit("warn", msg, { ...base, ...ctx }),
    error: (msg: string, err?: unknown, ctx?: LogContext) => emit("error", msg, { ...base, ...ctx }, err),
  };
}

export const logger = createLogger();
export type Logger = ReturnType<typeof createLogger>;
