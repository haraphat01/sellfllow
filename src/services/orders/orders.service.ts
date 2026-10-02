import "server-only";

import type { DbClient } from "@/lib/supabase/types";
import type { Enums, Tables } from "@/db/types/database";

export class OrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderError";
  }
}

export type OrderItemInput = { product_id: string; variant_id?: string | null; quantity: number };

export type QuoteLine = {
  product_id: string;
  variant_id: string | null;
  name: string;
  variant_label: string | null;
  unit_price_minor: number;
  quantity: number;
  total_minor: number;
  available: boolean;
};

export type Quote = {
  lines: QuoteLine[];
  subtotal_minor: number;
  delivery_zone: string | null;
  delivery_fee_minor: number;
  delivery_eta: string | null;
  total_minor: number;
  currency: string;
  problems: string[];
};

/** Prices items and delivery from the database. Service role. */
export async function quoteOrder(admin: DbClient, businessId: string, items: OrderItemInput[], deliveryZone: string | null): Promise<Quote> {
  const { data, error } = await admin.rpc("quote_order", {
    p_business_id: businessId,
    p_items: items.map((i) => ({ product_id: i.product_id, variant_id: i.variant_id ?? null, quantity: i.quantity })),
    p_delivery_zone: deliveryZone ?? undefined,
  });
  if (error) throw error;
  return data as unknown as Quote;
}

function friendly(message: string) {
  const m = message.replace(/^order not possible:\s*/, "");
  return m.charAt(0).toUpperCase() + m.slice(1);
}

/**
 * Creates an order and reserves stock atomically (see create_order in SQL).
 * The caller must have authorised the action (AI agent for its own
 * conversation, or a staff member with orders.manage).
 */
export async function createOrder(
  admin: DbClient,
  p: {
    businessId: string;
    customerId: string;
    conversationId: string | null;
    items: OrderItemInput[];
    deliveryZone: string | null;
    deliveryAddress: string;
    customerName: string;
    source: Enums<"order_source">;
    aiAssisted: boolean;
    idempotencyKey: string;
    createdBy?: string | null;
    notes?: string | null;
  },
): Promise<Pick<Tables<"orders">, "id" | "order_number" | "total_minor" | "currency" | "status">> {
  const { data: orderId, error } = await admin.rpc("create_order", {
    p_business_id: p.businessId,
    p_customer_id: p.customerId,
    // Nullable in SQL; generated types mark them required strings.
    p_conversation_id: (p.conversationId ?? null) as unknown as string,
    p_items: p.items.map((i) => ({ product_id: i.product_id, variant_id: i.variant_id ?? null, quantity: i.quantity })),
    p_delivery_zone: (p.deliveryZone ?? null) as unknown as string,
    p_delivery_address: p.deliveryAddress,
    p_customer_name: p.customerName,
    p_source: p.source,
    p_ai_assisted: p.aiAssisted,
    p_idempotency_key: p.idempotencyKey,
    p_created_by: p.createdBy ?? undefined,
    p_notes: p.notes ?? undefined,
  });
  if (error) {
    if (error.code === "22023" || error.code === "P0002") throw new OrderError(friendly(error.message));
    throw error;
  }
  const { data: order, error: readError } = await admin
    .from("orders")
    .select("id, order_number, total_minor, currency, status")
    .eq("business_id", p.businessId)
    .eq("id", orderId as string)
    .single();
  if (readError) throw readError;
  return order;
}

export async function cancelOrder(admin: DbClient, p: { businessId: string; orderId: string; reason: string; actorId?: string | null }) {
  const { data, error } = await admin.rpc("cancel_order", {
    p_business_id: p.businessId,
    p_order_id: p.orderId,
    p_reason: p.reason,
    p_actor: p.actorId ?? undefined,
  });
  if (error) {
    if (error.code === "22023" || error.code === "P0002") throw new OrderError(friendly(error.message));
    throw error;
  }
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// Dashboard (user client, RLS: orders.view / orders.manage)
// ---------------------------------------------------------------------------
export const ORDER_STATUSES = ["pending_payment", "paid", "processing", "shipped", "delivered", "cancelled", "refunded"] as const;
export const PAGE_SIZE = 30;

export async function listOrders(db: DbClient, businessId: string, opts: { status?: Enums<"order_status">; q?: string; page?: number }) {
  const page = Math.max(1, opts.page ?? 1);
  let query = db
    .from("orders")
    .select("id, order_number, status, source, ai_assisted, total_minor, currency, customer_name, customer_phone, created_at, paid_at, order_items(count)", { count: "exact" })
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (opts.status) query = query.eq("status", opts.status);
  const q = (opts.q ?? "").replace(/[%_\\,()"]/g, " ").trim().slice(0, 60);
  if (q) {
    const num = Number(q.replace(/^#/, ""));
    query = Number.isInteger(num) && num > 0 ? query.eq("order_number", num) : query.or(`customer_name.ilike.%${q}%,customer_phone.ilike.%${q}%`);
  }
  const { data, count, error } = await query;
  if (error) throw error;
  return {
    items: (data ?? []).map((o) => ({ ...o, item_count: (o.order_items as unknown as { count: number }[])?.[0]?.count ?? 0 })),
    total: count ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
  };
}

export async function getOrder(db: DbClient, businessId: string, orderId: string) {
  const { data: order, error } = await db.from("orders").select("*").eq("business_id", businessId).eq("id", orderId).maybeSingle();
  if (error) throw error;
  if (!order) return null;
  const [items, payments, history] = await Promise.all([
    db.from("order_items").select("*").eq("business_id", businessId).eq("order_id", orderId).order("created_at"),
    db.from("payments").select("id, reference, amount_minor, currency, status, channel, paid_at, created_at, failure_reason, refund_requested_at, collection_mode, claimed_at, proof_message_id, confirmed_by, rejected_at, rejection_note").eq("business_id", businessId).eq("order_id", orderId).order("created_at", { ascending: false }),
    db.from("audit_logs").select("action, actor_type, actor_user_id, metadata, created_at").eq("business_id", businessId).eq("entity_id", orderId).order("created_at"),
  ]);
  return { order, items: items.data ?? [], payments: payments.data ?? [], history: history.data ?? [] };
}

const NEXT_STATUS: Partial<Record<Enums<"order_status">, Enums<"order_status">>> = {
  paid: "processing",
  processing: "shipped",
  shipped: "delivered",
};

export function nextFulfilmentStatus(status: Enums<"order_status">) {
  return NEXT_STATUS[status] ?? null;
}

/** Moves a paid order forward (paid → processing → shipped → delivered). User client; DB guard enforces order. */
export async function advanceFulfilment(db: DbClient, businessId: string, orderId: string, to: Enums<"order_status">) {
  const { data, error } = await db.from("orders").update({ status: to }).eq("business_id", businessId).eq("id", orderId).select("id");
  if (error) {
    if (/must be paid|only move forward|managed by SellFlow/.test(error.message)) throw new OrderError(error.message.charAt(0).toUpperCase() + error.message.slice(1));
    throw error;
  }
  if (!data?.length) throw new OrderError("Order not found or you can't change it.");
}

export async function updateOrderNotes(db: DbClient, businessId: string, orderId: string, notes: string | null) {
  const { error } = await db.from("orders").update({ notes }).eq("business_id", businessId).eq("id", orderId);
  if (error) throw error;
}
