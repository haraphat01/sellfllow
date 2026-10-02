import { z } from "zod";

export const PRODUCT_STATUSES = ["active", "draft", "archived"] as const;

/** "45,000" / "₦45,000.50" / "45000" -> 4500050 minor units. */
export function parseMoneyToMinor(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? Math.round(input * 100) : null;
  if (typeof input !== "string") return null;
  const cleaned = input.replace(/[^\d.]/g, "");
  if (!cleaned || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** "Color: Black, Size: 42" -> { color: "Black", size: "42" } */
export function parseVariantOptions(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of input.split(/[,;]/)) {
    const idx = part.indexOf(":");
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim().toLowerCase().replace(/\s+/g, "_").slice(0, 30);
    const value = part.slice(idx + 1).trim().slice(0, 60);
    if (key && value) out[key] = value;
  }
  return out;
}

export function formatVariantOptions(options: Record<string, unknown> | null | undefined) {
  return Object.entries(options ?? {})
    .map(([k, v]) => `${k.charAt(0).toUpperCase()}${k.slice(1).replaceAll("_", " ")}: ${String(v)}`)
    .join(", ");
}

const money = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const minor = parseMoneyToMinor(v);
    if (minor === null) {
      ctx.addIssue({ code: "custom", message: "Enter a valid price, e.g. 45000" });
      return z.NEVER;
    }
    return minor;
  });

const optionalMoney = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const minor = parseMoneyToMinor(v);
    if (minor === null) {
      ctx.addIssue({ code: "custom", message: "Enter a valid price" });
      return z.NEVER;
    }
    return minor;
  });

const stock = z.coerce
  .number({ error: "Stock must be a whole number" })
  .int("Stock must be a whole number")
  .min(0, "Stock can't be negative")
  .max(1_000_000);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const variantInputSchema = z.object({
  id: z.uuid().optional().nullable(),
  name: z.string().trim().min(1, "Variant name is required").max(100),
  options: z.string().max(300).default(""),
  sku: optionalText(64),
  price: optionalMoney,
  stock: stock.default(0),
});

export const productInputSchema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(200),
  description: optionalText(5000),
  sku: optionalText(64),
  price: money,
  stock: stock.default(0),
  trackInventory: z.boolean().default(true),
  status: z.enum(PRODUCT_STATUSES).default("active"),
  category: optionalText(80),
  brand: optionalText(80),
  variants: z.array(variantInputSchema).max(100).default([]),
});

export type ProductInput = z.infer<typeof productInputSchema>;
export type VariantInput = z.infer<typeof variantInputSchema>;

export function productInputFromForm(form: FormData) {
  let variants: unknown = [];
  try {
    variants = JSON.parse(String(form.get("variants") ?? "[]"));
  } catch {
    variants = "invalid";
  }
  return productInputSchema.safeParse({
    name: form.get("name"),
    description: form.get("description"),
    sku: form.get("sku"),
    price: form.get("price"),
    stock: form.get("stock") || 0,
    trackInventory: form.get("trackInventory") === "on",
    status: form.get("status") || "active",
    category: form.get("category"),
    brand: form.get("brand"),
    variants,
  });
}
