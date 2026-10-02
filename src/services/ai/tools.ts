import "server-only";

import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { logger } from "@/lib/observability/logger";
import { formatMoney } from "@/lib/money";
import { formatVariantOptions } from "@/lib/products/schema";
import type { DbClient } from "@/lib/supabase/types";
import type { Enums, Json } from "@/db/types/database";
import { getPlan, isOverLimit } from "@/services/billing/limits";
import { cancelOrder, createOrder, OrderError, quoteOrder } from "@/services/orders/orders.service";
import { createPaymentLink, PaymentError, refreshOrderPayment } from "@/services/payments/payments.service";

import { extractAmountsMinor } from "./grounding";

/**
 * Tools for the AI sales agent. Every tool is created per request and closes
 * over server-established context (business, conversation, customer). The
 * model can only supply the validated inputs below — it can never choose a
 * tenant or another customer. Every call is written to ai_actions.
 */

export type ToolContext = {
  admin: DbClient;
  businessId: string;
  conversationId: string;
  customerId: string;
  currency: string;
  aiRequestId: string;
  /** Playground: read-only, nothing is written. */
  dryRun: boolean;
  /** When this agent run started — a quote made in an earlier run means the customer has replied since. */
  turnStartedAt: Date;
  /** Recent messages the customer actually received from us (used to verify they saw a quote). */
  assistantTexts: string[];
  capabilities: { orders: boolean; payments: boolean };
  /** Mutable per-turn record used for grounding checks and state. */
  turn: {
    outputs: unknown[];
    state: Record<string, unknown>;
    handoff: { reason: string; summary: string } | null;
    /** Serialises state writes: tools in one step run in parallel. */
    persistChain?: Promise<void>;
  };
};

const AI_SETTABLE_STAGES = ["product_discovery", "product_question", "purchase_intent", "collecting_customer_details", "order_confirmation"] as const;
const INTENT_STAGES: ReadonlyArray<string> = ["purchase_intent", "collecting_customer_details", "order_confirmation"];

const uuid = z.uuid("Use an id returned by search_products/get_product");

function money(minor: number, currency: string) {
  return formatMoney(minor, currency);
}

async function record(ctx: ToolContext, name: string, input: unknown, run: () => Promise<unknown>) {
  const started = Date.now();
  let output: unknown;
  let status: "ok" | "error" = "ok";
  let error: string | null = null;
  try {
    output = await run();
    ctx.turn.outputs.push(output);
    return output;
  } catch (err) {
    status = "error";
    error = err instanceof Error ? err.message : String(err);
    output = { error: "The tool failed. Tell the customer you'll check with the team, then call handoff_to_human." };
    return output;
  } finally {
    if (!ctx.dryRun) {
      const { error: logError } = await ctx.admin.from("ai_actions").insert({
        business_id: ctx.businessId,
        conversation_id: ctx.conversationId,
        ai_request_id: ctx.aiRequestId,
        tool_name: name,
        input: (input ?? {}) as Json,
        output: JSON.parse(JSON.stringify(output ?? null)) as Json,
        status,
        error,
        duration_ms: Date.now() - started,
      });
      if (logError) logger.warn("ai.action_log_failed", { ai_request_id: ctx.aiRequestId, error: logError.message });
    }
  }
}

export function createSalesTools(ctx: ToolContext): ToolSet {
  const db = ctx.admin;

  const search_products = tool({
    description: "Search this business's active products by name, type, colour, brand or category. Returns prices and stock. Use before answering any product or price question.",
    inputSchema: z.object({
      query: z.string().min(1).max(100).describe("What the customer is looking for, e.g. 'black bag'"),
      limit: z.number().int().min(1).max(8).optional(),
    }),
    execute: (input) =>
      record(ctx, "search_products", input, async () => {
        const { data, error } = await db.rpc("search_products", { p_business_id: ctx.businessId, p_query: input.query, p_limit: input.limit ?? 5 });
        if (error) throw error;
        return {
          products: (data ?? []).map((p) => ({
            product_id: p.id,
            name: p.name,
            price_minor: p.price_minor,
            price: money(p.price_minor, p.currency),
            in_stock: !p.track_inventory || p.stock_quantity > 0,
            stock_quantity: p.track_inventory ? p.stock_quantity : null,
            has_variants: p.variant_count > 0,
            category: p.category,
            brand: p.brand,
          })),
          note: (data ?? []).length ? undefined : "No matching products. Do not invent any.",
        };
      }),
  });

  const get_product = tool({
    description: "Get full details of one product: description, price, variants (sizes/colours) with their own prices and stock.",
    inputSchema: z.object({ product_id: uuid }),
    execute: (input) =>
      record(ctx, "get_product", input, async () => {
        const { data: p } = await db
          .from("products")
          .select("id, name, description, price_minor, currency, track_inventory, stock_quantity, category, brand, product_variants(id, name, options, price_minor, stock_quantity, is_active)")
          .eq("business_id", ctx.businessId)
          .eq("id", input.product_id)
          .eq("status", "active")
          .maybeSingle();
        if (!p) return { found: false, note: "Product not found or not for sale." };
        const variants = ((p.product_variants ?? []) as { id: string; name: string; options: Record<string, unknown>; price_minor: number | null; stock_quantity: number; is_active: boolean }[])
          .filter((v) => v.is_active)
          .map((v) => {
            const price = v.price_minor ?? p.price_minor;
            return {
              variant_id: v.id,
              name: v.name,
              options: formatVariantOptions(v.options),
              price_minor: price,
              price: money(price, p.currency),
              in_stock: !p.track_inventory || v.stock_quantity > 0,
              stock_quantity: p.track_inventory ? v.stock_quantity : null,
            };
          });
        return {
          found: true,
          product_id: p.id,
          name: p.name,
          description: p.description?.slice(0, 1500) ?? null,
          price_minor: p.price_minor,
          price: money(p.price_minor, p.currency),
          in_stock: !p.track_inventory || p.stock_quantity > 0,
          stock_quantity: p.track_inventory ? p.stock_quantity : null,
          category: p.category,
          brand: p.brand,
          variants,
        };
      }),
  });

  const check_inventory = tool({
    description: "Check whether a quantity of a product (or a specific variant) is in stock right now.",
    inputSchema: z.object({ product_id: uuid, variant_id: uuid.optional(), quantity: z.number().int().min(1).max(100).default(1) }),
    execute: (input) =>
      record(ctx, "check_inventory", input, async () => {
        const { data: p } = await db
          .from("products")
          .select("id, name, track_inventory, stock_quantity, product_variants(id, name, stock_quantity, is_active)")
          .eq("business_id", ctx.businessId)
          .eq("id", input.product_id)
          .eq("status", "active")
          .maybeSingle();
        if (!p) return { found: false };
        const variants = (p.product_variants ?? []) as { id: string; name: string; stock_quantity: number; is_active: boolean }[];
        if (input.variant_id) {
          const v = variants.find((x) => x.id === input.variant_id && x.is_active);
          if (!v) return { found: false, note: "Variant not found for this product." };
          return { found: true, product: p.name, variant: v.name, available: !p.track_inventory || v.stock_quantity >= input.quantity, stock_quantity: p.track_inventory ? v.stock_quantity : null };
        }
        if (variants.some((v) => v.is_active)) {
          return { found: true, product: p.name, note: "This product has variants — ask which one and check that variant.", variants: variants.filter((v) => v.is_active).map((v) => ({ variant_id: v.id, name: v.name, in_stock: !p.track_inventory || v.stock_quantity > 0 })) };
        }
        return { found: true, product: p.name, available: !p.track_inventory || p.stock_quantity >= input.quantity, stock_quantity: p.track_inventory ? p.stock_quantity : null };
      }),
  });

  const get_business_policy = tool({
    description: "Get the business's delivery zones and fees, delivery times, returns, payment and hours. Use for any delivery fee/time question.",
    inputSchema: z.object({ topic: z.enum(["delivery", "returns", "payment", "hours", "discounts", "all"]) }),
    execute: (input) =>
      record(ctx, "get_business_policy", input, async () => {
        const { data: s } = await db
          .from("ai_settings")
          .select("return_policy, delivery_policy, delivery_zones, business_hours, discount_rules, max_discount_percent, payment_rules")
          .eq("business_id", ctx.businessId)
          .single();
        const zones = ((s?.delivery_zones ?? []) as { name?: string; fee_minor?: number; eta?: string }[])
          .filter((z) => z.name && Number.isInteger(z.fee_minor))
          .map((z) => ({ zone: z.name, fee_minor: z.fee_minor as number, fee: money(z.fee_minor as number, ctx.currency), eta: z.eta ?? null }));
        const all = input.topic === "all";
        return {
          ...(all || input.topic === "delivery" ? { delivery_policy: s?.delivery_policy ?? null, delivery_zones: zones, note: zones.length ? undefined : "No delivery fees configured — do not quote a fee; hand off if asked." } : {}),
          ...(all || input.topic === "returns" ? { return_policy: s?.return_policy ?? null } : {}),
          ...(all || input.topic === "payment" ? { payment_rules: s?.payment_rules ?? null } : {}),
          ...(all || input.topic === "hours" ? { business_hours: s?.business_hours ?? null } : {}),
          ...(all || input.topic === "discounts" ? { discount_rules: s?.discount_rules ?? null, max_discount_percent: Number(s?.max_discount_percent ?? 0) } : {}),
        };
      }),
  });

  const get_customer = tool({
    description: "Get what the business knows about the customer you are talking to (name, saved address, past orders).",
    inputSchema: z.object({}),
    execute: (input) =>
      record(ctx, "get_customer", input, async () => {
        const [{ data: c }, { data: orders }] = await Promise.all([
          db.from("customers").select("name, profile_name, address, total_orders, last_purchase_at").eq("business_id", ctx.businessId).eq("id", ctx.customerId).single(),
          db.from("orders").select("order_number, status, total_minor, currency, created_at").eq("business_id", ctx.businessId).eq("customer_id", ctx.customerId).order("created_at", { ascending: false }).limit(3),
        ]);
        return {
          name: c?.name ?? c?.profile_name ?? null,
          saved_address: (c?.address as { line1?: string } | null)?.line1 ?? null,
          total_orders: c?.total_orders ?? 0,
          recent_orders: (orders ?? []).map((o) => ({ order_number: o.order_number, status: o.status, total_minor: o.total_minor, total: money(o.total_minor, o.currency) })),
        };
      }),
  });

  const update_conversation_state = tool({
    description: "Record what you've learned about the customer's purchase so far. Call whenever intent, product, variant, quantity, name or delivery details become clear.",
    inputSchema: z.object({
      stage: z.enum(AI_SETTABLE_STAGES).optional(),
      intent: z.enum(["browsing", "question", "purchase", "support", "other"]).optional(),
      product_id: uuid.optional(),
      variant_id: uuid.optional(),
      quantity: z.number().int().min(1).max(100).optional(),
      customer_name: z.string().trim().min(1).max(100).optional(),
      delivery_location: z.string().trim().max(120).optional(),
      delivery_zone: z.string().trim().max(80).optional().describe("Exact zone name from get_business_policy"),
      delivery_address: z.string().trim().max(300).optional(),
    }),
    execute: (input) =>
      record(ctx, "update_conversation_state", input, async () => {
        // Tools in one model step run in parallel, so collect changes first and
        // merge them into the latest state only after all lookups (see applyStatePatch).
        const changes: Record<string, unknown> = {};
        const removals: string[] = [];
        if (input.product_id) {
          const { data: p } = await db.from("products").select("id, name").eq("business_id", ctx.businessId).eq("id", input.product_id).maybeSingle();
          if (!p) return { ok: false, note: "Unknown product_id — use one from search results." };
          changes.product_id = p.id;
          changes.product_name = p.name;
          if (!input.variant_id) removals.push("variant_id", "variant_name");
        }
        if (input.variant_id) {
          const productId = (changes.product_id as string | undefined) ?? (ctx.turn.state.product_id as string | undefined);
          const { data: v } = await db.from("product_variants").select("id, name").eq("business_id", ctx.businessId).eq("id", input.variant_id).eq("product_id", productId ?? "").maybeSingle();
          if (!v) return { ok: false, note: "Unknown variant_id for the chosen product." };
          changes.variant_id = v.id;
          changes.variant_name = v.name;
        }
        for (const k of ["intent", "quantity", "customer_name", "delivery_location", "delivery_zone", "delivery_address"] as const) {
          if (input[k] !== undefined) changes[k] = input[k];
        }
        if (input.stage) changes.purchase_stage = input.stage;
        changes.updated_at = new Date().toISOString();

        const extra: { purchase_stage?: Enums<"purchase_stage">; sales_outcome?: Enums<"sales_outcome">; purchase_intent_at?: string } = {};
        if (input.stage) extra.purchase_stage = input.stage;
        if (input.stage && INTENT_STAGES.includes(input.stage)) {
          extra.sales_outcome = "interested_not_purchased";
          extra.purchase_intent_at = new Date().toISOString();
        }
        await applyStatePatch(ctx, changes, removals, extra);

        if (!ctx.dryRun && input.customer_name) {
          await db.from("customers").update({ name: input.customer_name }).eq("business_id", ctx.businessId).eq("id", ctx.customerId).is("name", null);
        }
        return { ok: true };
      }),
  });

  const handoff_to_human = tool({
    description: "Hand the conversation to the human team. Use when unsure, when the customer asks for a person, complains, wants a refund, or (if you can't create orders) is ready to buy.",
    inputSchema: z.object({
      reason: z.enum(["customer_request", "complaint", "refund", "unsure", "ready_to_order", "other"]),
      summary: z.string().trim().min(1).max(500).describe("One or two sentences for the team: what the customer wants"),
    }),
    execute: (input) =>
      record(ctx, "handoff_to_human", input, async () => {
        ctx.turn.handoff = { reason: input.reason, summary: input.summary };
        if (!ctx.dryRun) await applyHandoff(ctx.admin, { businessId: ctx.businessId, conversationId: ctx.conversationId, reason: input.reason, summary: input.summary, aiRequestId: ctx.aiRequestId });
        return { ok: true, note: "The team has been notified. Tell the customer someone will reply shortly. Do not promise a time." };
      }),
  });

  const base = { search_products, get_product, check_inventory, get_business_policy, get_customer, update_conversation_state, handoff_to_human };
  if (!ctx.capabilities.orders) return base;
  return { ...base, ...createOrderTools(ctx) };
}

type PendingQuote = {
  quote_id: string;
  items: { product_id: string; variant_id: string | null; quantity: number }[];
  delivery_zone: string | null;
  total_minor: number;
  quoted_at: string;
};

/**
 * Merges `changes` into the latest in-memory state (synchronously — safe when
 * several tools of one step finish in any order), then queues a DB write of the
 * state *as it is when the write runs*, so the final write always holds the
 * newest state. The sales outcome never regresses once an order is paid.
 */
async function applyStatePatch(
  ctx: ToolContext,
  changes: Record<string, unknown>,
  removals: string[] = [],
  extra: { purchase_stage?: Enums<"purchase_stage">; needs_attention?: boolean; sales_outcome?: Enums<"sales_outcome">; purchase_intent_at?: string } = {},
) {
  const merged = { ...ctx.turn.state, ...changes };
  for (const k of removals) delete merged[k];
  ctx.turn.state = merged;
  if (ctx.dryRun) return;

  const write = async () => {
    const { error } = await ctx.admin
      .from("conversations")
      .update({ state: ctx.turn.state as Json, ...extra })
      .eq("business_id", ctx.businessId)
      .eq("id", ctx.conversationId)
      .neq("sales_outcome", "purchased");
    if (error) throw error;
  };
  const next = (ctx.turn.persistChain ?? Promise.resolve()).then(write);
  ctx.turn.persistChain = next.catch(() => undefined);
  await next;
}

function createOrderTools(ctx: ToolContext): ToolSet {
  const db = ctx.admin;
  const fmt = (minor: number) => money(minor, ctx.currency);

  const calculate_order_total = tool({
    description:
      "Price an order exactly: items (use product_id/variant_id from search results) plus the delivery zone. Returns the breakdown to show the customer. Always call this before create_order.",
    inputSchema: z.object({
      items: z.array(z.object({ product_id: uuid, variant_id: uuid.optional(), quantity: z.number().int().min(1).max(100) })).min(1).max(10),
      delivery_zone: z.string().trim().max(80).optional().describe("Exact zone name from get_business_policy"),
    }),
    execute: (input) =>
      record(ctx, "calculate_order_total", input, async () => {
        const q = await quoteOrder(db, ctx.businessId, input.items, input.delivery_zone ?? null);
        const result = {
          ok: q.problems.length === 0,
          problems: q.problems,
          lines: q.lines.map((l) => ({
            name: l.name,
            variant: l.variant_label,
            quantity: l.quantity,
            unit_price_minor: l.unit_price_minor,
            unit_price: fmt(l.unit_price_minor),
            total_minor: l.total_minor,
            total: fmt(l.total_minor),
          })),
          subtotal_minor: q.subtotal_minor,
          subtotal: fmt(q.subtotal_minor),
          delivery_zone: q.delivery_zone,
          delivery_fee_minor: q.delivery_fee_minor,
          delivery_fee: fmt(q.delivery_fee_minor),
          delivery_eta: q.delivery_eta,
          total_minor: q.total_minor,
          total: fmt(q.total_minor),
        };
        if (!result.ok) {
          await applyStatePatch(ctx, {}, ["pending_quote"]);
          return { ...result, next: "Explain the problem to the customer and offer alternatives. Do not create an order." };
        }
        const pending: PendingQuote = {
          quote_id: crypto.randomUUID(),
          items: q.lines.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity })),
          delivery_zone: q.delivery_zone,
          total_minor: q.total_minor,
          quoted_at: new Date().toISOString(),
        };
        await applyStatePatch(ctx, { pending_quote: pending, purchase_stage: "order_confirmation" }, [], { purchase_stage: "order_confirmation" });
        return { ...result, next: "Show the customer this exact breakdown (items, delivery, total) and ask them to confirm. Wait for their reply before calling create_order." };
      }),
  });

  const create_order = tool({
    description:
      "Create the order from the most recent quote AFTER the customer has explicitly confirmed it in their latest message. Needs the customer's name and delivery address recorded with update_conversation_state.",
    inputSchema: z.object({ confirmed: z.literal(true).describe("true only if the customer's latest message confirms the quoted total") }),
    execute: (input) =>
      record(ctx, "create_order", input, async () => {
        const state = ctx.turn.state as { pending_quote?: PendingQuote; customer_name?: string; delivery_address?: string };
        const q = state.pending_quote;
        if (!q) return { ok: false, next: "There is no quote to confirm. Call calculate_order_total, show the breakdown, and wait for the customer to confirm." };
        if (new Date(q.quoted_at) >= ctx.turnStartedAt) {
          return { ok: false, next: "The customer hasn't replied to this quote yet. Show them the breakdown and wait for their confirmation." };
        }
        const shown = ctx.assistantTexts.some((t) => extractAmountsMinor(t).includes(q.total_minor));
        if (!shown) return { ok: false, next: "The customer hasn't been shown this total. Show the breakdown with the total and ask them to confirm." };
        if (!state.customer_name || !state.delivery_address) {
          return { ok: false, next: "Ask for the customer's full name and delivery address, record them with update_conversation_state, then confirm again." };
        }

        if (ctx.dryRun) {
          return { ok: true, order_number: "PREVIEW", total_minor: q.total_minor, total: fmt(q.total_minor), status: "pending_payment", note: "Playground: no order was created." };
        }

        // Plan limit: monthly orders.
        const plan = await getPlan(db, ctx.businessId);
        if (!plan || (await isOverLimit(db, ctx.businessId, plan, "orders"))) {
          await db.from("notifications").insert({
            business_id: ctx.businessId,
            type: "usage.limit_reached",
            title: "Monthly order limit reached",
            body: "A customer tried to order on WhatsApp but your plan's monthly order limit is used up. Upgrade in Billing, or create the order manually.",
            data: { metric: "orders", conversation_id: ctx.conversationId },
          });
          return { ok: false, problem: "The shop can't take new orders in chat right now.", next: "Apologise and hand off to the team with handoff_to_human (reason ready_to_order) so a person completes the order." };
        }

        let order;
        try {
          order = await createOrder(db, {
            businessId: ctx.businessId,
            customerId: ctx.customerId,
            conversationId: ctx.conversationId,
            items: q.items,
            deliveryZone: q.delivery_zone,
            deliveryAddress: state.delivery_address,
            customerName: state.customer_name,
            source: "ai",
            aiAssisted: true,
            idempotencyKey: `${ctx.conversationId}:${q.quote_id}`,
          });
        } catch (err) {
          if (err instanceof OrderError) {
            await applyStatePatch(ctx, {}, ["pending_quote"]);
            return { ok: false, problem: err.message, next: "Tell the customer what changed (e.g. stock) and offer to re-quote." };
          }
          throw err;
        }

        await applyStatePatch(
          ctx,
          { order_id: order.id, order_number: order.order_number, purchase_stage: "payment_pending" },
          ["pending_quote"],
          { purchase_stage: "payment_pending", ...(ctx.capabilities.payments ? {} : { needs_attention: true }) },
        );
        await db.from("conversation_events").insert({
          business_id: ctx.businessId,
          conversation_id: ctx.conversationId,
          type: "order_created",
          actor_type: "ai",
          data: { order_id: order.id, order_number: order.order_number, total_minor: order.total_minor, ai_request_id: ctx.aiRequestId },
        });
        await db.from("notifications").insert({
          business_id: ctx.businessId,
          type: "order.created",
          title: `New order #${order.order_number}`,
          body: `${fmt(order.total_minor)} — awaiting payment`,
          data: { order_id: order.id, conversation_id: ctx.conversationId },
        });

        // Full breakdown from the stored order, so a confirmation that repeats item prices/delivery is grounded.
        const { data: placed } = await db
          .from("orders")
          .select("subtotal_minor, delivery_fee_minor, delivery_address, order_items(name, variant_label, quantity, unit_price_minor, total_minor)")
          .eq("id", order.id)
          .single();
        return {
          ok: true,
          order_number: order.order_number,
          lines: ((placed?.order_items ?? []) as { name: string; variant_label: string | null; quantity: number; unit_price_minor: number; total_minor: number }[]).map((l) => ({
            name: l.name,
            variant: l.variant_label,
            quantity: l.quantity,
            unit_price_minor: l.unit_price_minor,
            unit_price: fmt(l.unit_price_minor),
            total_minor: l.total_minor,
            total: fmt(l.total_minor),
          })),
          subtotal_minor: placed?.subtotal_minor ?? null,
          delivery_fee_minor: placed?.delivery_fee_minor ?? null,
          delivery_fee: placed ? fmt(placed.delivery_fee_minor) : null,
          delivery_address: (placed?.delivery_address as { address?: string } | null)?.address ?? null,
          total_minor: order.total_minor,
          total: fmt(order.total_minor),
          status: order.status,
          next: ctx.capabilities.payments
            ? "Call create_payment_link and send the link."
            : "Tell the customer their order number and total, and that the team will send payment details shortly. Do not invent payment instructions.",
        };
      }),
  });

  const get_order = tool({
    description: "Look up one of THIS customer's orders by its number (status, items, total, whether it's paid).",
    inputSchema: z.object({ order_number: z.number().int().positive() }),
    execute: (input) =>
      record(ctx, "get_order", input, async () => {
        const { data: o } = await db
          .from("orders")
          .select("order_number, status, subtotal_minor, delivery_fee_minor, total_minor, currency, paid_at, created_at, order_items(name, variant_label, quantity, unit_price_minor, total_minor)")
          .eq("business_id", ctx.businessId)
          .eq("customer_id", ctx.customerId)
          .eq("order_number", input.order_number)
          .maybeSingle();
        if (!o) return { found: false, note: "No order with that number for this customer." };
        return {
          found: true,
          order_number: o.order_number,
          status: o.status,
          paid: Boolean(o.paid_at),
          subtotal_minor: o.subtotal_minor,
          delivery_fee_minor: o.delivery_fee_minor,
          total_minor: o.total_minor,
          total: money(o.total_minor, o.currency),
          items: (o.order_items as { name: string; variant_label: string | null; quantity: number; unit_price_minor: number; total_minor: number }[]).map((i) => ({
            item: `${i.quantity} × ${i.name}${i.variant_label ? ` (${i.variant_label})` : ""}`,
            unit_price_minor: i.unit_price_minor,
            total_minor: i.total_minor,
            total: money(i.total_minor, o.currency),
          })),
        };
      }),
  });

  const cancel_order = tool({
    description: "Cancel THIS customer's unpaid order when they clearly ask to cancel it.",
    inputSchema: z.object({ order_number: z.number().int().positive(), reason: z.string().trim().min(1).max(200) }),
    execute: (input) =>
      record(ctx, "cancel_order", input, async () => {
        const { data: o } = await db
          .from("orders")
          .select("id, status, paid_at")
          .eq("business_id", ctx.businessId)
          .eq("customer_id", ctx.customerId)
          .eq("order_number", input.order_number)
          .maybeSingle();
        if (!o) return { ok: false, note: "No order with that number for this customer." };
        if (o.paid_at) return { ok: false, next: "This order is paid — hand off to the team for a refund." };
        if (ctx.dryRun) return { ok: true, note: "Playground: nothing was cancelled." };
        try {
          await cancelOrder(db, { businessId: ctx.businessId, orderId: o.id, reason: `Customer asked (AI): ${input.reason}` });
        } catch (err) {
          if (err instanceof OrderError) return { ok: false, problem: err.message };
          throw err;
        }
        return { ok: true, order_number: input.order_number, status: "cancelled" };
      }),
  });

  if (!ctx.capabilities.payments) return { calculate_order_total, create_order, get_order, cancel_order };

  async function findOrder(orderNumber?: number) {
    const q = db.from("orders").select("id, order_number, status, total_minor, currency").eq("business_id", ctx.businessId).eq("customer_id", ctx.customerId);
    const { data } = orderNumber
      ? await q.eq("order_number", orderNumber).maybeSingle()
      : await q.eq("id", (ctx.turn.state.order_id as string | undefined) ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
    return data;
  }

  const create_payment_link = tool({
    description: "Get the secure Paystack payment link for THIS customer's order awaiting payment (defaults to the order just created). Send the link exactly as returned.",
    inputSchema: z.object({ order_number: z.number().int().positive().optional() }),
    execute: (input) =>
      record(ctx, "create_payment_link", input, async () => {
        const order = await findOrder(input.order_number);
        if (!order) return { ok: false, note: "No such order for this customer." };
        if (order.status !== "pending_payment") return { ok: false, status: order.status, note: `Order #${order.order_number} is ${order.status.replaceAll("_", " ")} — no payment needed.` };
        if (ctx.dryRun) return { ok: true, order_number: order.order_number, url: "https://checkout.paystack.com/preview", total_minor: order.total_minor, total: money(order.total_minor, order.currency), note: "Playground: no real link was created." };
        try {
          const link = await createPaymentLink(db, { businessId: ctx.businessId, orderId: order.id });
          return { ok: true, order_number: link.orderNumber, url: link.url, total_minor: link.amountMinor, total: money(link.amountMinor, link.currency), next: "Send this link. Say payment is confirmed automatically on WhatsApp once Paystack confirms it." };
        } catch (err) {
          if (err instanceof PaymentError) return { ok: false, problem: err.message, next: "Apologise and call handoff_to_human so the team can help with payment." };
          throw err;
        }
      }),
  });

  const get_payment_status = tool({
    description: "Check with Paystack whether THIS customer's order has been paid. Use whenever the customer says they've paid. Never say payment succeeded unless this returns paid: true.",
    inputSchema: z.object({ order_number: z.number().int().positive().optional() }),
    execute: (input) =>
      record(ctx, "get_payment_status", input, async () => {
        const order = await findOrder(input.order_number);
        if (!order) return { found: false };
        if (order.status !== "pending_payment" || ctx.dryRun) {
          return { found: true, order_number: order.order_number, paid: ["paid", "processing", "shipped", "delivered"].includes(order.status), status: order.status, total_minor: order.total_minor };
        }
        const r = await refreshOrderPayment(db, { businessId: ctx.businessId, orderId: order.id });
        const paid = r?.outcome === "paid" || r?.outcome === "already_paid";
        return {
          found: true,
          order_number: order.order_number,
          paid,
          status: paid ? "paid" : "awaiting payment",
          total_minor: order.total_minor,
          note: paid ? "Confirmed by Paystack." : "Paystack has not confirmed a payment yet. Ask them to complete checkout with the link, or hand off if they insist they've paid.",
        };
      }),
  });

  return { calculate_order_total, create_order, get_order, cancel_order, create_payment_link, get_payment_status };
}

/** Stops the AI for this conversation and flags it for the team. */
export async function applyHandoff(admin: DbClient, p: { businessId: string; conversationId: string; reason: string; summary: string; aiRequestId?: string }) {
  await admin
    .from("conversations")
    .update({ ai_mode: "HUMAN_ACTIVE", needs_attention: true, purchase_stage: "human_handoff" })
    .eq("business_id", p.businessId)
    .eq("id", p.conversationId);
  await admin.from("conversation_events").insert({
    business_id: p.businessId,
    conversation_id: p.conversationId,
    type: "handoff_requested",
    actor_type: "ai",
    data: { reason: p.reason, summary: p.summary, ai_request_id: p.aiRequestId ?? null },
  });
  await admin.from("notifications").insert({
    business_id: p.businessId,
    type: "conversation.handoff",
    title: "A customer needs a human",
    body: p.summary.slice(0, 300),
    data: { conversation_id: p.conversationId, reason: p.reason },
  });
}
