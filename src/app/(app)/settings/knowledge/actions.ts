"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionResult, type FormState } from "@/lib/actions";
import { authorize } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { faqFromForm } from "@/lib/validation/faqs";
import { createFaq, deleteFaq, searchFaqs, updateFaq } from "@/services/knowledge/faqs.service";

const id = z.uuid();

export async function saveFaqAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = faqFromForm(form);
  if (!parsed.success) return { error: "Please fix the highlighted fields.", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  const existingId = String(form.get("id") ?? "");
  if (existingId && !id.safeParse(existingId).success) return { error: "Invalid Q&A." };
  try {
    const ctx = await authorize("settings.manage");
    const db = await createClient();
    if (existingId) await updateFaq(db, { businessId: ctx.business.id, id: existingId, input: parsed.data });
    else await createFaq(db, { businessId: ctx.business.id, userId: ctx.user.id, input: parsed.data });
    revalidatePath("/settings/knowledge");
    return { ok: true, message: existingId ? "Q&A updated" : "Q&A added — the AI will use it right away" };
  } catch (err) {
    return { error: toActionError(err, { action: "faq.save" }) };
  }
}

export async function deleteFaqAction(faqId: string): Promise<ActionResult> {
  if (!id.safeParse(faqId).success) return { ok: false, error: "Invalid Q&A." };
  try {
    const ctx = await authorize("settings.manage");
    await deleteFaq(await createClient(), { businessId: ctx.business.id, id: faqId });
    revalidatePath("/settings/knowledge");
    return { ok: true, message: "Q&A deleted" };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "faq.delete" }) };
  }
}

/** "Try it": what the AI would find for a customer's question. */
export async function testFaqSearchAction(question: string): Promise<ActionResult<{ hits: { question: string; answer: string }[] }>> {
  const q = question.trim().slice(0, 300);
  if (q.length < 2) return { ok: false, error: "Type a question a customer might ask." };
  try {
    const ctx = await authorize("settings.manage");
    const hits = await searchFaqs(await createClient(), ctx.business.id, q, 3);
    return { ok: true, data: { hits: hits.map((h) => ({ question: h.question, answer: h.answer })) } };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "faq.test" }) };
  }
}
