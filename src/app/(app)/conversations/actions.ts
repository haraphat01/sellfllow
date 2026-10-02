"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionResult } from "@/lib/actions";
import { authorize } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { addNote, assignConversation, markRead, setAiMode, setConversationStatus } from "@/services/conversations/conversations.service";
import { sendConversationText } from "@/services/whatsapp/outbound.service";

const id = z.uuid();

function refresh(conversationId: string) {
  revalidatePath("/conversations", "layout");
  revalidatePath(`/conversations/${conversationId}`);
}

/**
 * Staff reply. Replying while the AI is active hands the conversation to the
 * human first, so the AI can't talk over them.
 */
export async function sendReplyAction(conversationId: string, body: string): Promise<ActionResult> {
  if (!id.safeParse(conversationId).success) return { ok: false, error: "Invalid conversation." };
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return { ok: false, error: "Type a message first." };
  if (text.length > 4096) return { ok: false, error: "WhatsApp messages can be up to 4,096 characters." };

  try {
    const ctx = await authorize("conversations.reply");
    const db = await createClient();
    const { data: conv } = await db.from("conversations").select("ai_mode, status").eq("business_id", ctx.business.id).eq("id", conversationId).maybeSingle();
    if (!conv) return { ok: false, error: "Conversation not found." };
    if (conv.status === "closed") return { ok: false, error: "Reopen this conversation to reply." };
    if (conv.ai_mode === "AI_ACTIVE") {
      await setAiMode(db, { businessId: ctx.business.id, conversationId, userId: ctx.user.id, mode: "HUMAN_ACTIVE" });
    }
    await sendConversationText(createAdminClient(), {
      businessId: ctx.business.id,
      conversationId,
      body: text,
      sender: "staff",
      senderUserId: ctx.user.id,
    });
    refresh(conversationId);
    return { ok: true };
  } catch (err) {
    refresh(conversationId);
    return { ok: false, error: toActionError(err, { action: "conversation.reply", conversation_id: conversationId }) };
  }
}

export async function setAiModeAction(conversationId: string, mode: "AI_ACTIVE" | "HUMAN_ACTIVE" | "PAUSED"): Promise<ActionResult> {
  if (!id.safeParse(conversationId).success || !["AI_ACTIVE", "HUMAN_ACTIVE", "PAUSED"].includes(mode)) return { ok: false, error: "Invalid request." };
  try {
    const ctx = await authorize("conversations.reply");
    await setAiMode(await createClient(), { businessId: ctx.business.id, conversationId, userId: ctx.user.id, mode });
    refresh(conversationId);
    return { ok: true, message: mode === "AI_ACTIVE" ? "AI resumed" : mode === "PAUSED" ? "AI paused" : "You’ve taken over this conversation" };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "conversation.ai_mode", conversation_id: conversationId }) };
  }
}

export async function assignAction(conversationId: string, assigneeId: string | null): Promise<ActionResult> {
  if (!id.safeParse(conversationId).success || (assigneeId !== null && !id.safeParse(assigneeId).success)) return { ok: false, error: "Invalid request." };
  try {
    const ctx = await authorize("conversations.reply");
    await assignConversation(await createClient(), { businessId: ctx.business.id, conversationId, userId: ctx.user.id, assigneeId });
    refresh(conversationId);
    return { ok: true, message: assigneeId ? "Conversation assigned" : "Conversation unassigned" };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "conversation.assign", conversation_id: conversationId }) };
  }
}

export async function addNoteAction(conversationId: string, text: string): Promise<ActionResult> {
  if (!id.safeParse(conversationId).success || typeof text !== "string") return { ok: false, error: "Invalid request." };
  try {
    const ctx = await authorize("conversations.reply");
    await addNote(await createClient(), { businessId: ctx.business.id, conversationId, userId: ctx.user.id, text });
    refresh(conversationId);
    return { ok: true, message: "Note added" };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "conversation.note", conversation_id: conversationId }) };
  }
}

export async function setStatusAction(conversationId: string, status: "open" | "closed"): Promise<ActionResult> {
  if (!id.safeParse(conversationId).success || !["open", "closed"].includes(status)) return { ok: false, error: "Invalid request." };
  try {
    const ctx = await authorize("conversations.reply");
    await setConversationStatus(await createClient(), { businessId: ctx.business.id, conversationId, userId: ctx.user.id, status });
    refresh(conversationId);
    return { ok: true, message: status === "closed" ? "Conversation resolved" : "Conversation reopened" };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "conversation.status", conversation_id: conversationId }) };
  }
}

export async function markReadAction(conversationId: string): Promise<void> {
  if (!id.safeParse(conversationId).success) return;
  try {
    const ctx = await authorize("conversations.view");
    await markRead(createAdminClient(), ctx.business.id, conversationId);
    revalidatePath("/conversations", "layout");
  } catch {
    // Best effort.
  }
}
