import { z } from "zod";

import { parseMoneyToMinor } from "@/lib/products/schema";

export const LIMIT_KEYS = ["monthly_ai_conversations", "messages", "orders", "customers", "products", "staff", "whatsapp_numbers", "campaigns"] as const;
export const FEATURE_KEYS = ["follow_ups", "campaigns", "advanced_analytics", "api", "priority_support"] as const;

const reason = z.string().trim().min(3, "Give a reason (shown to the business and kept in the audit log)").max(300);

export const suspendSchema = z.object({ businessId: z.uuid(), suspend: z.boolean(), reason });

export const grantPlanSchema = z.object({
  businessId: z.uuid(),
  planCode: z.string().regex(/^[a-z0-9_]{1,40}$/),
  days: z.coerce.number().int().min(1).max(366),
  reason,
});

export const extendTrialSchema = z.object({ businessId: z.uuid(), days: z.coerce.number().int().min(1).max(90), reason });

/** Limits: empty = unlimited. */
const limit = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 10_000_000) {
      ctx.addIssue({ code: "custom", message: "Whole number, or empty for unlimited" });
      return z.NEVER;
    }
    return n;
  });

export const planSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9_]{2,40}$/, "Lowercase letters, numbers and _"),
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(300).transform((v) => v || null),
  price: z.string().transform((v, ctx) => {
    const minor = parseMoneyToMinor(v);
    if (minor === null || minor < 0) {
      ctx.addIssue({ code: "custom", message: "Enter a price, e.g. 24900" });
      return z.NEVER;
    }
    return minor;
  }),
  interval: z.enum(["monthly", "annually"]),
  sort_order: z.coerce.number().int().min(0).max(1000),
  is_active: z.boolean(),
  is_public: z.boolean(),
  limits: z.object(Object.fromEntries(LIMIT_KEYS.map((k) => [k, limit])) as Record<(typeof LIMIT_KEYS)[number], typeof limit>),
  features: z.object(Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean()])) as Record<(typeof FEATURE_KEYS)[number], z.ZodBoolean>),
});

export function planFromForm(form: FormData) {
  const s = (k: string) => String(form.get(k) ?? "");
  return planSchema.safeParse({
    code: s("code"),
    name: s("name"),
    description: s("description"),
    price: s("price"),
    interval: s("interval") || "monthly",
    sort_order: s("sort_order") || "0",
    is_active: form.get("is_active") === "on",
    is_public: form.get("is_public") === "on",
    limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, s(`limit_${k}`)])),
    features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, form.get(`feature_${k}`) === "on"])),
  });
}

export const platformSettingsSchema = z.object({
  trial_days: z.coerce.number().int().min(0).max(90),
  commission_percent: z.coerce.number().min(0, "0–20%").max(20, "0–20%").transform((v) => Math.round(v * 100) / 100),
  commission_flat: z.string().transform((v, ctx) => {
    const minor = v.trim() === "" ? 0 : parseMoneyToMinor(v);
    if (minor === null || minor < 0 || minor > 500_000) {
      ctx.addIssue({ code: "custom", message: "₦0 – ₦5,000" });
      return z.NEVER;
    }
    return minor;
  }),
});
