import "server-only";

import type { DbClient } from "@/lib/supabase/types";
import type { FaqInput } from "@/lib/validation/faqs";

/**
 * Business Q&A knowledge base. Dashboard functions take the user's client
 * (RLS: members read, settings.manage writes); the AI searches with the
 * service role, always scoped to one business.
 */

export class FaqError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FaqError";
  }
}

export const MAX_FAQS_PER_BUSINESS = 300;

export async function listFaqs(db: DbClient, businessId: string) {
  const { data, error } = await db
    .from("business_faqs")
    .select("id, question, answer, keywords, is_active, updated_at")
    .eq("business_id", businessId)
    .order("updated_at", { ascending: false })
    .limit(MAX_FAQS_PER_BUSINESS);
  if (error) throw error;
  return data ?? [];
}

export async function createFaq(db: DbClient, p: { businessId: string; userId: string; input: FaqInput }) {
  const { count } = await db.from("business_faqs").select("id", { count: "exact", head: true }).eq("business_id", p.businessId);
  if ((count ?? 0) >= MAX_FAQS_PER_BUSINESS) throw new FaqError(`You can have up to ${MAX_FAQS_PER_BUSINESS} Q&As. Remove ones you no longer need.`);
  const { data, error } = await db
    .from("business_faqs")
    .insert({ business_id: p.businessId, created_by: p.userId, question: p.input.question, answer: p.input.answer, keywords: p.input.keywords, is_active: p.input.isActive })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateFaq(db: DbClient, p: { businessId: string; id: string; input: FaqInput }) {
  const { data, error } = await db
    .from("business_faqs")
    .update({ question: p.input.question, answer: p.input.answer, keywords: p.input.keywords, is_active: p.input.isActive })
    .eq("business_id", p.businessId)
    .eq("id", p.id)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new FaqError("Q&A not found, or you can't edit it.");
}

export async function deleteFaq(db: DbClient, p: { businessId: string; id: string }) {
  const { data, error } = await db.from("business_faqs").delete().eq("business_id", p.businessId).eq("id", p.id).select("id");
  if (error) throw error;
  if (!data?.length) throw new FaqError("Q&A not found, or you can't delete it.");
}

/** Ranked search for the AI (and the dashboard's "try it" box). */
export async function searchFaqs(db: DbClient, businessId: string, query: string, limit = 3) {
  const { data, error } = await db.rpc("search_business_faqs", { p_business_id: businessId, p_query: query, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as { id: string; question: string; answer: string; score: number }[];
}
