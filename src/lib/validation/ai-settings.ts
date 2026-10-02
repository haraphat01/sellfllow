import { z } from "zod";

import { parseMoneyToMinor } from "@/lib/products/schema";

/**
 * Models offered in settings. "deepseek/…" uses DeepSeek's API directly;
 * others use AI Gateway ids. Verify ids against the providers when adding more.
 */
export const AI_MODELS = [
  { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5 — recommended (AI Gateway)" },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5 — fastest (AI Gateway)" },
  { id: "deepseek/deepseek-flash", label: "DeepSeek Flash — low cost (DeepSeek)" },
  { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro (DeepSeek)" },
] as const;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

export const deliveryZoneSchema = z.object({
  name: z.string().trim().min(1, "Zone name is required").max(80),
  fee: z.string().transform((v, ctx) => {
    const minor = parseMoneyToMinor(v);
    if (minor === null) {
      ctx.addIssue({ code: "custom", message: "Enter a fee, e.g. 3000 (0 for free)" });
      return z.NEVER;
    }
    return minor;
  }),
  eta: z.string().trim().max(60).optional().default(""),
});

export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  name: z.string().trim().min(1, "Give your assistant a name").max(60),
  tone: z.enum(["friendly", "professional", "playful", "concise"]),
  greeting: text(300),
  language: z.string().trim().min(2).max(10).default("en"),
  /** "" = platform default (AI_DEFAULT_MODEL). */
  model: z.union([z.literal(""), z.enum(AI_MODELS.map((m) => m.id) as [string, ...string[]])]).transform((v) => v || null),
  return_policy: text(2000),
  delivery_policy: text(2000),
  delivery_zones: z.array(deliveryZoneSchema).max(30),
  business_hours: text(300),
  discount_rules: text(1000),
  max_discount_percent: z.coerce.number().min(0).max(100),
  escalation_rules: text(1000),
  payment_rules: text(1000),
});

export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;

export function aiSettingsFromForm(form: FormData) {
  let zones: unknown = [];
  try {
    zones = JSON.parse(String(form.get("delivery_zones") ?? "[]"));
  } catch {
    zones = "invalid";
  }
  const s = (k: string) => String(form.get(k) ?? "");
  return aiSettingsSchema.safeParse({
    enabled: form.get("enabled") === "on",
    name: s("name"),
    tone: s("tone"),
    greeting: s("greeting"),
    language: s("language") || "en",
    model: s("model"),
    return_policy: s("return_policy"),
    delivery_policy: s("delivery_policy"),
    delivery_zones: zones,
    business_hours: s("business_hours"),
    discount_rules: s("discount_rules"),
    max_discount_percent: s("max_discount_percent") || 0,
    escalation_rules: s("escalation_rules"),
    payment_rules: s("payment_rules"),
  });
}
