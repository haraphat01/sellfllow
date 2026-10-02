import { z } from "zod";

const UNIT_MINUTES = { minutes: 1, hours: 60, days: 1440 } as const;
const ALLOWED_PLACEHOLDERS = new Set(["{name}", "{product}"]);

export const followUpSettingsSchema = z
  .object({
    enabled: z.boolean(),
    delay_value: z.coerce.number().int("Use a whole number").positive("Enter a delay"),
    delay_unit: z.enum(["minutes", "hours", "days"]),
    max: z.coerce.number().int().min(1, "At least 1").max(5, "At most 5"),
    message: z
      .string()
      .trim()
      .max(1000)
      .refine((v) => (v.match(/\{[^}]*\}/g) ?? []).every((p) => ALLOWED_PLACEHOLDERS.has(p)), "Only {name} and {product} can be used")
      .transform((v) => v || null),
    respect_hours: z.boolean(),
    window_start: z.coerce.number().int().min(0).max(23),
    window_end: z.coerce.number().int().min(1).max(24),
    template_name: z
      .string()
      .trim()
      .max(512)
      .regex(/^[a-z0-9_]*$/, "Template names use lowercase letters, numbers and underscores")
      .transform((v) => v || null),
    template_language: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, "e.g. en or en_US"),
    attribution_window_hours: z.coerce.number().int().min(1).max(720),
  })
  .transform(({ delay_value, delay_unit, ...rest }) => ({ ...rest, delay_minutes: delay_value * UNIT_MINUTES[delay_unit] }))
  .refine((v) => v.delay_minutes >= 15 && v.delay_minutes <= 10080, { message: "Choose between 15 minutes and 7 days", path: ["delay_value"] })
  .refine((v) => v.window_start < v.window_end, { message: "The window must end after it starts", path: ["window_end"] });

export type FollowUpSettingsInput = z.infer<typeof followUpSettingsSchema>;

export function followUpSettingsFromForm(form: FormData) {
  const s = (k: string) => String(form.get(k) ?? "");
  return followUpSettingsSchema.safeParse({
    enabled: form.get("enabled") === "on",
    delay_value: s("delay_value"),
    delay_unit: s("delay_unit"),
    max: s("max"),
    message: s("message"),
    respect_hours: form.get("respect_hours") === "on",
    window_start: s("window_start"),
    window_end: s("window_end"),
    template_name: s("template_name"),
    template_language: s("template_language") || "en",
    attribution_window_hours: s("attribution_window_hours"),
  });
}

/** Splits stored minutes into the largest whole unit for the form. */
export function delayToForm(minutes: number): { value: number; unit: "minutes" | "hours" | "days" } {
  if (minutes % 1440 === 0) return { value: minutes / 1440, unit: "days" };
  if (minutes % 60 === 0) return { value: minutes / 60, unit: "hours" };
  return { value: minutes, unit: "minutes" };
}
