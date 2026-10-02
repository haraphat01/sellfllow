import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const optionalUrl = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .refine((v) => v == null || /^https?:\/\/\S+\.\S+/.test(v), { message: "Enter a full URL starting with https://" });

export const INDUSTRIES = [
  "Fashion & apparel",
  "Beauty & cosmetics",
  "Electronics & gadgets",
  "Shoes & accessories",
  "Food & groceries",
  "Home & furniture",
  "Health & wellness",
  "Baby & kids",
  "Other",
] as const;

export const businessProfileSchema = z.object({
  name: z.string().trim().min(2, "Business name must be at least 2 characters").max(120),
  description: optionalText(1000),
  industry: z.enum(INDUSTRIES, { error: "Choose an industry" }),
  country: z.string().trim().length(2).toUpperCase().default("NG"),
  currency: z.enum(["NGN", "GHS", "KES", "ZAR", "USD"]).default("NGN"),
  timezone: z.string().trim().min(3).max(64).default("Africa/Lagos"),
  phone: optionalText(32).refine((v) => v == null || /^\+?[0-9 ()-]{7,20}$/.test(v), {
    message: "Enter a valid phone number",
  }),
  address: optionalText(300),
  website: optionalUrl,
  instagram: optionalText(100),
  facebook: optionalText(100),
  tiktok: optionalText(100),
});

export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;

export function businessProfileFromForm(form: FormData) {
  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };
  return businessProfileSchema.safeParse({
    name: get("name"),
    description: get("description"),
    industry: get("industry"),
    country: get("country") || undefined,
    currency: get("currency") || undefined,
    timezone: get("timezone") || undefined,
    phone: get("phone"),
    address: get("address"),
    website: get("website"),
    instagram: get("instagram"),
    facebook: get("facebook"),
    tiktok: get("tiktok"),
  });
}
