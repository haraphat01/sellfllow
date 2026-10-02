import "server-only";

import type { DbClient } from "@/lib/supabase/types";
import type { Enums, Tables } from "@/db/types/database";

export class ConversationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationError";
  }
}

export const INBOX_FILTERS = ["all", "attention", "mine", "unassigned", "ai", "human", "closed"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export type InboxItem = {
  id: string;
  status: Enums<"conversation_status">;
  aiMode: Enums<"ai_mode">;
  purchaseStage: Enums<"purchase_stage">;
  needsAttention: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastCustomerMessageAt: string | null;
  assignedTo: string | null;
  interestedIn: string | null;
  customer: { id: string; name: string | null; profileName: string | null; phone: string };
};

/** Strip characters that have meaning in PostgREST filter syntax. */
function searchTerm(q: string) {
  return q.replace(/[%_\\]/g, (c) => `\\${c}`).replace(/[,()"]/g, " ").trim().slice(0, 80);
}

export async function listInbox(db: DbClient, businessId: string, opts: { filter: InboxFilter; q?: string; userId: string; limit?: number }): Promise<InboxItem[]> {
  let query = db
    .from("conversations")
    .select(
      "id, status, ai_mode, purchase_stage, needs_attention, unread_count, last_message_at, last_message_preview, last_customer_message_at, assigned_to, state, customers!inner(id, name, profile_name, phone)",
    )
    .eq("business_id", businessId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(opts.limit ?? 60);

  switch (opts.filter) {
    case "closed":
      query = query.eq("status", "closed");
      break;
    case "attention":
      query = query.eq("status", "open").or("needs_attention.eq.true,and(ai_mode.eq.HUMAN_ACTIVE,unread_count.gt.0)");
      break;
    case "mine":
      query = query.eq("status", "open").eq("assigned_to", opts.userId);
      break;
    case "unassigned":
      query = query.eq("status", "open").is("assigned_to", null);
      break;
    case "ai":
      query = query.eq("status", "open").eq("ai_mode", "AI_ACTIVE");
      break;
    case "human":
      query = query.eq("status", "open").in("ai_mode", ["HUMAN_ACTIVE", "PAUSED"]);
      break;
    default:
      query = query.eq("status", "open");
  }

  const term = opts.q ? searchTerm(opts.q) : "";
  if (term) {
    query = query.or(`name.ilike.%${term}%,profile_name.ilike.%${term}%,phone.ilike.%${term}%`, { referencedTable: "customers" });
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((c) => {
    const customer = c.customers as unknown as { id: string; name: string | null; profile_name: string | null; phone: string };
    const state = (c.state ?? {}) as { product_name?: string };
    return {
      id: c.id,
      status: c.status,
      aiMode: c.ai_mode,
      purchaseStage: c.purchase_stage,
      needsAttention: c.needs_attention,
      unreadCount: c.unread_count,
      lastMessageAt: c.last_message_at,
      lastMessagePreview: c.last_message_preview,
      lastCustomerMessageAt: c.last_customer_message_at,
      assignedTo: c.assigned_to,
      interestedIn: state.product_name ?? null,
      customer: { id: customer.id, name: customer.name, profileName: customer.profile_name, phone: customer.phone },
    };
  });
}

export async function countNeedsAttention(db: DbClient, businessId: string) {
  const { count } = await db
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("status", "open")
    .or("needs_attention.eq.true,and(ai_mode.eq.HUMAN_ACTIVE,unread_count.gt.0)");
  return count ?? 0;
}

export type ThreadItem =
  | { kind: "message"; id: string; at: string; message: Pick<Tables<"messages">, "id" | "direction" | "sender" | "sender_user_id" | "type" | "body" | "status" | "error" | "created_at"> }
  | { kind: "event"; id: string; at: string; event: Pick<Tables<"conversation_events">, "id" | "type" | "actor_type" | "actor_user_id" | "data" | "created_at"> };

export async function getConversation(db: DbClient, businessId: string, conversationId: string) {
  const { data, error } = await db
    .from("conversations")
    .select("*, customers!inner(*), whatsapp_accounts(id, display_phone_number, status)")
    .eq("business_id", businessId)
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Latest `limit` messages + events, oldest first. `before` pages backwards. */
export async function getThread(db: DbClient, businessId: string, conversationId: string, opts: { limit?: number; before?: string } = {}) {
  const limit = opts.limit ?? 60;
  let mq = db
    .from("messages")
    .select("id, direction, sender, sender_user_id, type, body, status, error, created_at")
    .eq("business_id", businessId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (opts.before) mq = mq.lt("created_at", opts.before);

  const { data: messages, error } = await mq;
  if (error) throw error;
  const hasMore = (messages?.length ?? 0) > limit;
  const page = (messages ?? []).slice(0, limit);
  const oldest = page.at(-1)?.created_at;

  let eq = db
    .from("conversation_events")
    .select("id, type, actor_type, actor_user_id, data, created_at")
    .eq("business_id", businessId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (oldest && hasMore) eq = eq.gte("created_at", oldest);
  if (opts.before) eq = eq.lt("created_at", opts.before);
  const { data: events } = await eq;

  const items: ThreadItem[] = [
    ...page.map((m) => ({ kind: "message" as const, id: m.id, at: m.created_at, message: m })),
    ...(events ?? []).map((e) => ({ kind: "event" as const, id: e.id, at: e.created_at, event: e })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return { items, hasMore, oldest: oldest ?? null };
}

async function logEvent(db: DbClient, p: { businessId: string; conversationId: string; userId: string; type: string; data?: Record<string, unknown> }) {
  const { error } = await db.from("conversation_events").insert({
    business_id: p.businessId,
    conversation_id: p.conversationId,
    type: p.type,
    actor_type: "user",
    actor_user_id: p.userId,
    data: (p.data ?? {}) as never,
  });
  if (error) throw error;
}

/** Changes who (if anyone) replies automatically. `db` is the user's client (RLS: conversations.reply). */
export async function setAiMode(db: DbClient, p: { businessId: string; conversationId: string; userId: string; mode: Enums<"ai_mode"> }) {
  const { data: current } = await db.from("conversations").select("ai_mode, assigned_to").eq("business_id", p.businessId).eq("id", p.conversationId).maybeSingle();
  if (!current) throw new ConversationError("Conversation not found.");
  if (current.ai_mode === p.mode) return;

  const patch: Partial<Tables<"conversations">> = { ai_mode: p.mode };
  // Taking over assigns the conversation to you if nobody has it.
  if (p.mode === "HUMAN_ACTIVE" && !current.assigned_to) patch.assigned_to = p.userId;
  if (p.mode === "AI_ACTIVE") patch.needs_attention = false;

  const { data, error } = await db.from("conversations").update(patch).eq("business_id", p.businessId).eq("id", p.conversationId).select("id");
  if (error) throw error;
  if (!data?.length) throw new ConversationError("You can't change this conversation.");

  const type = p.mode === "HUMAN_ACTIVE" ? "human_takeover" : p.mode === "PAUSED" ? "ai_paused" : "ai_resumed";
  await logEvent(db, { businessId: p.businessId, conversationId: p.conversationId, userId: p.userId, type, data: { from: current.ai_mode, to: p.mode } });
}

export async function assignConversation(db: DbClient, p: { businessId: string; conversationId: string; userId: string; assigneeId: string | null }) {
  if (p.assigneeId) {
    // Assignee must be an active member who can reply.
    const { data: member } = await db
      .from("business_members")
      .select("role, permissions")
      .eq("business_id", p.businessId)
      .eq("user_id", p.assigneeId)
      .eq("status", "active")
      .maybeSingle();
    const canReply = member && (member.role !== "staff" || member.permissions.includes("conversations.reply"));
    if (!canReply) throw new ConversationError("That person can't reply to conversations.");
  }
  const { data, error } = await db
    .from("conversations")
    .update({ assigned_to: p.assigneeId })
    .eq("business_id", p.businessId)
    .eq("id", p.conversationId)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new ConversationError("You can't change this conversation.");
  await logEvent(db, { businessId: p.businessId, conversationId: p.conversationId, userId: p.userId, type: "assigned", data: { assignee: p.assigneeId } });
}

export async function addNote(db: DbClient, p: { businessId: string; conversationId: string; userId: string; text: string }) {
  const text = p.text.trim();
  if (!text) throw new ConversationError("Note is empty.");
  if (text.length > 2000) throw new ConversationError("Notes can be up to 2,000 characters.");
  await logEvent(db, { businessId: p.businessId, conversationId: p.conversationId, userId: p.userId, type: "note", data: { text } });
}

export async function setConversationStatus(db: DbClient, p: { businessId: string; conversationId: string; userId: string; status: "open" | "closed" }) {
  const patch: Partial<Tables<"conversations">> =
    p.status === "closed" ? { status: "closed", needs_attention: false, unread_count: 0 } : { status: "open" };
  const { data, error } = await db.from("conversations").update(patch).eq("business_id", p.businessId).eq("id", p.conversationId).select("id");
  if (error?.code === "23505") throw new ConversationError("This customer already has another open conversation on this number.");
  if (error) throw error;
  if (!data?.length) throw new ConversationError("You can't change this conversation.");
  await logEvent(db, { businessId: p.businessId, conversationId: p.conversationId, userId: p.userId, type: p.status === "closed" ? "closed" : "reopened" });
}

/** Viewers without reply permission can still clear unread, so this uses the service client after authorisation. */
export async function markRead(admin: DbClient, businessId: string, conversationId: string) {
  await admin.from("conversations").update({ unread_count: 0 }).eq("business_id", businessId).eq("id", conversationId).gt("unread_count", 0);
}

export async function listAssignableMembers(db: DbClient, businessId: string) {
  const { data: members } = await db.from("business_members").select("user_id, role, permissions").eq("business_id", businessId).eq("status", "active");
  const eligible = (members ?? []).filter((m) => m.role !== "staff" || m.permissions.includes("conversations.reply"));
  const { data: profiles } = await db.from("profiles").select("id, full_name, email").in("id", eligible.map((m) => m.user_id));
  return (profiles ?? []).map((p) => ({ id: p.id, name: p.full_name ?? p.email }));
}
