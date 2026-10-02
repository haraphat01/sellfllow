import "server-only";

import { z } from "zod";

import type { DbClient } from "@/lib/supabase/types";
import type { Enums } from "@/db/types/database";

export class CustomerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerError";
  }
}

export const CUSTOMER_STATUSES = ["lead", "interested", "customer", "repeat_customer", "inactive"] as const;
export const PAGE_SIZE = 30;

function searchTerm(q: string) {
  return q.replace(/[%_\\]/g, (c) => `\\${c}`).replace(/[,()"]/g, " ").trim().slice(0, 80);
}

export async function listCustomers(
  db: DbClient,
  businessId: string,
  opts: { q?: string; status?: Enums<"customer_status">; tag?: string; page?: number },
) {
  const page = Math.max(1, opts.page ?? 1);
  let query = db
    .from("customers")
    .select(
      opts.tag
        ? "id, name, profile_name, phone, status, total_orders, total_spend_minor, last_interaction_at, opted_out_at, customer_tags!inner(tag)"
        : "id, name, profile_name, phone, status, total_orders, total_spend_minor, last_interaction_at, opted_out_at, customer_tags(tag)",
      { count: "exact" },
    )
    .eq("business_id", businessId)
    .order("last_interaction_at", { ascending: false, nullsFirst: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (opts.status) query = query.eq("status", opts.status);
  if (opts.tag) query = query.eq("customer_tags.tag", opts.tag);
  const term = opts.q ? searchTerm(opts.q) : "";
  if (term) query = query.or(`name.ilike.%${term}%,profile_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`);

  const { data, count, error } = await query;
  if (error) throw error;
  return {
    items: (data ?? []).map((c) => ({ ...c, tags: ((c.customer_tags ?? []) as { tag: string }[]).map((t) => t.tag) })),
    total: count ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
  };
}

export async function listTags(db: DbClient, businessId: string) {
  const { data } = await db.from("customer_tags").select("tag").eq("business_id", businessId).limit(2000);
  return Array.from(new Set((data ?? []).map((t) => t.tag))).sort((a, b) => a.localeCompare(b));
}

export async function getCustomer(db: DbClient, businessId: string, customerId: string) {
  const { data, error } = await db.from("customers").select("*, customer_tags(tag)").eq("business_id", businessId).eq("id", customerId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, tags: ((data.customer_tags ?? []) as { tag: string }[]).map((t) => t.tag).sort() };
}

export async function getCustomerActivity(db: DbClient, businessId: string, customerId: string, canViewOrders: boolean) {
  const [conversations, orders] = await Promise.all([
    db
      .from("conversations")
      .select("id, status, ai_mode, last_message_at, last_message_preview")
      .eq("business_id", businessId)
      .eq("customer_id", customerId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(10),
    canViewOrders
      ? db
          .from("orders")
          .select("id, order_number, status, total_minor, currency, created_at")
          .eq("business_id", businessId)
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  return { conversations: conversations.data ?? [], orders: orders.data ?? [] };
}

export const customerUpdateSchema = z.object({
  name: z.string().trim().max(120).transform((v) => v || null),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .transform((v) => v || null)
    .pipe(z.email("Enter a valid email").nullable()),
  address: z.string().trim().max(500).transform((v) => v || null),
  notes: z.string().trim().max(5000).transform((v) => v || null),
  status: z.enum(CUSTOMER_STATUSES),
});

export async function updateCustomer(db: DbClient, businessId: string, customerId: string, input: z.infer<typeof customerUpdateSchema>) {
  const { data, error } = await db
    .from("customers")
    .update({
      name: input.name,
      email: input.email,
      address: input.address ? { line1: input.address } : null,
      notes: input.notes,
      status: input.status,
    })
    .eq("business_id", businessId)
    .eq("id", customerId)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new CustomerError("You can't edit this customer.");
}

export const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Tag is empty")
  .max(40, "Tags can be up to 40 characters")
  .regex(/^[\p{L}\p{N} _-]+$/u, "Use letters, numbers, spaces, - or _");

export async function addTag(db: DbClient, businessId: string, customerId: string, tag: string) {
  const { error } = await db.from("customer_tags").insert({ business_id: businessId, customer_id: customerId, tag });
  if (error?.code === "23505") return;
  if (error?.code === "42501") throw new CustomerError("You can't tag customers.");
  if (error) throw error;
}

export async function removeTag(db: DbClient, businessId: string, customerId: string, tag: string) {
  const { error } = await db.from("customer_tags").delete().eq("business_id", businessId).eq("customer_id", customerId).eq("tag", tag);
  if (error) throw error;
}
