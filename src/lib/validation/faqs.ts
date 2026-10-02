import { z } from "zod";

/** "pickup, collect,  waybill" → ["pickup","collect","waybill"] (deduped, lower-case). */
export function parseKeywords(raw: string) {
  return Array.from(new Set(raw.split(/[,\n]/).map((k) => k.trim().toLowerCase()).filter(Boolean))).slice(0, 20);
}

export const faqSchema = z.object({
  question: z.string().trim().min(3, "Write the question as a customer would ask it").max(300),
  answer: z.string().trim().min(1, "Write the answer").max(2000),
  keywords: z.array(z.string().max(40, "Keep each keyword short")).max(20),
  isActive: z.boolean(),
});

export type FaqInput = z.infer<typeof faqSchema>;

export function faqFromForm(form: FormData) {
  return faqSchema.safeParse({
    question: String(form.get("question") ?? ""),
    answer: String(form.get("answer") ?? ""),
    keywords: parseKeywords(String(form.get("keywords") ?? "")),
    isActive: form.get("isActive") === "on",
  });
}
