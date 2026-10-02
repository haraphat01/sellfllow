import "server-only";

import type { DbClient } from "@/lib/supabase/types";

/**
 * Customer + conversation lookups shared by inbound processing and outbound
 * sends. Service-role client; business_id always passed explicitly.
 */

export async function upsertCustomer(
  admin: DbClient,
  params: { businessId: string; waId: string; profileName?: string | null; interactionAt?: Date },
): Promise<{ id: string; name: string | null; opted_out_at: string | null }> {
  const row: Record<string, unknown> = {
    business_id: params.businessId,
    wa_id: params.waId,
    phone: `+${params.waId}`,
  };
  if (params.profileName) row.profile_name = params.profileName.slice(0, 200);
  if (params.interactionAt) row.last_interaction_at = params.interactionAt.toISOString();

  const { data, error } = await admin
    .from("customers")
    .upsert(row as never, { onConflict: "business_id,wa_id" })
    .select("id, name, opted_out_at")
    .single();
  if (error) throw error;
  return data;
}

/** Returns the open conversation for this customer on this number, creating it if needed. */
export async function ensureOpenConversation(
  admin: DbClient,
  params: { businessId: string; customerId: string; whatsappAccountId: string },
): Promise<{ id: string; ai_mode: string; unread_count: number; created: boolean }> {
  const find = () =>
    admin
      .from("conversations")
      .select("id, ai_mode, unread_count")
      .eq("business_id", params.businessId)
      .eq("customer_id", params.customerId)
      .eq("whatsapp_account_id", params.whatsappAccountId)
      .eq("status", "open")
      .maybeSingle();

  const { data: existing, error: findError } = await find();
  if (findError) throw findError;
  if (existing) return { ...existing, created: false };

  const { data, error } = await admin
    .from("conversations")
    .insert({ business_id: params.businessId, customer_id: params.customerId, whatsapp_account_id: params.whatsappAccountId })
    .select("id, ai_mode, unread_count")
    .single();

  if (error?.code === "23505") {
    // Lost a race with a concurrent insert: use the winner.
    const { data: winner } = await find();
    if (winner) return { ...winner, created: false };
  }
  if (error) throw error;
  return { ...data, created: true };
}

export function preview(text: string | null, type: string) {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t) return t.length > 140 ? `${t.slice(0, 139)}…` : t;
  return type === "text" ? "" : `[${type}]`;
}
