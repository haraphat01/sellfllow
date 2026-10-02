import "server-only";

import type { DbClient } from "@/lib/supabase/types";
import { daysAgoIso } from "@/lib/time";
import type { BusinessProfileInput } from "@/lib/validation/business";

function socialLinks(input: BusinessProfileInput) {
  return Object.fromEntries(
    (["instagram", "facebook", "tiktok"] as const).filter((k) => input[k]).map((k) => [k, input[k]]),
  );
}

/**
 * Creates a tenant through the `create_business` RPC (which makes the caller
 * the owner and provisions trial + AI defaults), then fills in the profile.
 * `db` must be the signed-in user's client.
 */
export async function createBusiness(db: DbClient, input: BusinessProfileInput): Promise<string> {
  const { data: businessId, error } = await db.rpc("create_business", {
    p_name: input.name,
    p_industry: input.industry,
    p_country: input.country,
    p_currency: input.currency,
    p_timezone: input.timezone,
  });
  if (error || !businessId) throw new Error(error?.message ?? "Could not create business");

  const { error: updateError } = await db
    .from("businesses")
    .update({
      description: input.description ?? null,
      phone: input.phone ?? null,
      address: input.address ?? null,
      website: input.website ?? null,
      social_links: socialLinks(input),
      onboarding_step: "whatsapp",
    })
    .eq("id", businessId);
  if (updateError) throw new Error(updateError.message);

  return businessId;
}

export async function updateBusinessProfile(db: DbClient, businessId: string, input: BusinessProfileInput) {
  const { error } = await db
    .from("businesses")
    .update({
      name: input.name,
      description: input.description ?? null,
      industry: input.industry,
      country: input.country,
      currency: input.currency,
      timezone: input.timezone,
      phone: input.phone ?? null,
      address: input.address ?? null,
      website: input.website ?? null,
      social_links: socialLinks(input),
    })
    .eq("id", businessId);
  if (error) throw new Error(error.message);
}

export type SetupChecklist = {
  whatsappConnected: boolean;
  productCount: number;
  aiEnabled: boolean;
  paystackConnected: boolean;
};

export async function getSetupChecklist(db: DbClient, businessId: string, paystackConnected = false): Promise<SetupChecklist> {
  const [wa, products, agent] = await Promise.all([
    db.from("whatsapp_accounts").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "connected"),
    db.from("products").select("id", { count: "exact", head: true }).eq("business_id", businessId).neq("status", "archived"),
    db.from("ai_agents").select("enabled").eq("business_id", businessId).maybeSingle(),
  ]);
  return {
    whatsappConnected: (wa.count ?? 0) > 0,
    productCount: products.count ?? 0,
    aiEnabled: agent.data?.enabled ?? false,
    paystackConnected,
  };
}

export type DashboardSummary = {
  conversations: number;
  customers: number;
  orders: number;
  paidRevenueMinor: number;
};

/** Headline numbers for the last 30 days (RLS-scoped). */
export async function getDashboardSummary(db: DbClient, businessId: string): Promise<DashboardSummary> {
  const since = daysAgoIso(30);
  const [conversations, customers, orders, paid] = await Promise.all([
    db.from("conversations").select("id", { count: "exact", head: true }).eq("business_id", businessId).gte("created_at", since),
    db.from("customers").select("id", { count: "exact", head: true }).eq("business_id", businessId),
    db.from("orders").select("id", { count: "exact", head: true }).eq("business_id", businessId).gte("created_at", since),
    db.from("orders").select("total_minor").eq("business_id", businessId).not("paid_at", "is", null).gte("paid_at", since),
  ]);
  return {
    conversations: conversations.count ?? 0,
    customers: customers.count ?? 0,
    orders: orders.count ?? 0,
    paidRevenueMinor: (paid.data ?? []).reduce((sum, o) => sum + o.total_minor, 0),
  };
}
