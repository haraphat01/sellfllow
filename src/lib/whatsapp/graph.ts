import "server-only";

import { requireServerEnv, serverEnv } from "@/lib/env/server";

/**
 * Minimal Meta Graph API client for the WhatsApp Cloud API. One instance per
 * access token (a business's token from Embedded Signup, or a system-user
 * token for manual connections). Tokens never leave the server.
 */

export class GraphApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: number,
    public subcode?: number,
    public fbtraceId?: string,
  ) {
    super(message);
    this.name = "GraphApiError";
  }

  /** 24h customer-service window closed: only templates can be sent. */
  get isOutsideWindow() {
    return this.code === 131047;
  }

  get isAuthError() {
    return this.code === 190 || this.status === 401;
  }
}

const TIMEOUT_MS = 15_000;

function baseUrl() {
  const env = serverEnv();
  const host = process.env.NODE_ENV !== "production" && env.META_GRAPH_BASE_URL ? env.META_GRAPH_BASE_URL.replace(/\/$/, "") : "https://graph.facebook.com";
  return `${host}/${env.META_GRAPH_API_VERSION}`;
}

async function graphFetch<T>(path: string, init: { method?: string; token?: string; body?: unknown; query?: Record<string, string>; timeoutMs?: number } = {}): Promise<T> {
  const url = new URL(`${baseUrl()}/${path.replace(/^\//, "")}`);
  Object.entries(init.query ?? {}).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string } } & T;
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    throw new GraphApiError(e.message ?? `Graph API request failed (${res.status})`, res.status, e.code, e.error_subcode, e.fbtrace_id);
  }
  return json;
}

/** Exchanges an Embedded Signup code (30s TTL) for a business integration system-user token. */
export async function exchangeSignupCode(code: string): Promise<string> {
  const data = await graphFetch<{ access_token: string }>("oauth/access_token", {
    query: {
      client_id: requireServerEnv("META_APP_ID"),
      client_secret: requireServerEnv("META_APP_SECRET"),
      code,
    },
  });
  if (!data.access_token) throw new GraphApiError("No access token returned", 500);
  return data.access_token;
}

export type PhoneNumberInfo = {
  id: string;
  display_phone_number: string;
  verified_name?: string;
  quality_rating?: string;
  code_verification_status?: string;
  /** e.g. CONNECTED, PENDING, DISCONNECTED */
  status?: string;
  /** CLOUD_API once registered for the Cloud API */
  platform_type?: string;
};

/** True when Meta reports the number as already registered and usable on the Cloud API. */
export function isRegisteredOnCloudApi(info: Pick<PhoneNumberInfo, "status" | "platform_type">) {
  return info.platform_type === "CLOUD_API" && info.status === "CONNECTED";
}

/** Registration can take Meta well over the default timeout. */
const REGISTER_TIMEOUT_MS = 60_000;

export type SendResult = { waMessageId: string };

export type MessageTemplate = {
  name: string;
  language: string;
  status: string;
  category?: string;
  components?: { type: string; format?: string; text?: string; buttons?: { type: string; url?: string; text?: string }[] }[];
};

/**
 * A template can be sent with no parameters when no component has a
 * placeholder ({{1}}) and the header (if any) is text.
 */
export function templateNeedsNoParameters(t: MessageTemplate) {
  return (t.components ?? []).every((c) => {
    if (c.type === "HEADER" && c.format && c.format !== "TEXT") return false;
    if (c.text && /\{\{\s*[^}]+\s*\}\}/.test(c.text)) return false;
    if (c.type === "BUTTONS" && (c.buttons ?? []).some((b) => (b.url && /\{\{/.test(b.url)) || b.type === "COPY_CODE" || b.type === "OTP")) return false;
    return true;
  });
}

export function whatsappClient(token: string) {
  return {
    getPhoneNumber: (phoneNumberId: string) =>
      graphFetch<PhoneNumberInfo>(phoneNumberId, {
        token,
        query: { fields: "id,display_phone_number,verified_name,quality_rating,code_verification_status,status,platform_type" },
      }),

    /** Webhooks for this WABA are delivered to our app. */
    subscribeApp: (wabaId: string) => graphFetch<{ success: boolean }>(`${wabaId}/subscribed_apps`, { method: "POST", token }),

    unsubscribeApp: (wabaId: string) => graphFetch<{ success: boolean }>(`${wabaId}/subscribed_apps`, { method: "DELETE", token }),

    /** Registers the number for Cloud API use with a 6-digit two-step verification PIN. */
    registerPhoneNumber: (phoneNumberId: string, pin: string) =>
      graphFetch<{ success: boolean }>(`${phoneNumberId}/register`, { method: "POST", token, body: { messaging_product: "whatsapp", pin }, timeoutMs: REGISTER_TIMEOUT_MS }),

    /** Sets (or replaces) the number's two-step verification PIN. Only for numbers already on the Cloud API. */
    setTwoStepPin: (phoneNumberId: string, pin: string) => graphFetch<{ success: boolean }>(phoneNumberId, { method: "POST", token, body: { pin } }),

    sendText: async (phoneNumberId: string, to: string, body: string, replyTo?: string): Promise<SendResult> => {
      const res = await graphFetch<{ messages: { id: string }[] }>(`${phoneNumberId}/messages`, {
        method: "POST",
        token,
        body: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body, preview_url: true },
          ...(replyTo ? { context: { message_id: replyTo } } : {}),
        },
      });
      return { waMessageId: res.messages[0].id };
    },

    sendTemplate: async (
      phoneNumberId: string,
      to: string,
      template: { name: string; language: string; components?: unknown[] },
    ): Promise<SendResult> => {
      const res = await graphFetch<{ messages: { id: string }[] }>(`${phoneNumberId}/messages`, {
        method: "POST",
        token,
        body: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "template",
          template: { name: template.name, language: { code: template.language }, ...(template.components ? { components: template.components } : {}) },
        },
      });
      return { waMessageId: res.messages[0].id };
    },

    /** Templates on the WhatsApp Business Account (needs whatsapp_business_management). */
    listTemplates: async (wabaId: string): Promise<MessageTemplate[]> => {
      const res = await graphFetch<{ data: MessageTemplate[] }>(`${wabaId}/message_templates`, {
        token,
        query: { fields: "name,language,status,category,components", limit: "200" },
      });
      return res.data ?? [];
    },

    markRead: (phoneNumberId: string, waMessageId: string) =>
      graphFetch<{ success: boolean }>(`${phoneNumberId}/messages`, {
        method: "POST",
        token,
        body: { messaging_product: "whatsapp", status: "read", message_id: waMessageId },
      }),
  };
}

export type WhatsAppClient = ReturnType<typeof whatsappClient>;
