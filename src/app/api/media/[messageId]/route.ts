import { NextResponse, type NextRequest } from "next/server";

import { AuthorizationError } from "@/lib/auth/errors";
import { authorize } from "@/lib/auth/session";
import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClientForAccount } from "@/services/whatsapp/accounts.service";

const ALLOWED_TYPES = /^(image\/(jpeg|png|webp)|application\/pdf)$/;

/**
 * Streams a customer's WhatsApp image/document (e.g. a transfer receipt) to
 * team members of the same business. Media never leaves Meta without the
 * business's token, and is never cached publicly.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) return NextResponse.json({ error: "not found" }, { status: 404 });
  let businessId: string;
  try {
    const ctx = await authorize();
    if (!ctx.can("conversations.view") && !ctx.can("orders.view")) throw new AuthorizationError();
    businessId = ctx.business.id;
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: msg } = await admin
    .from("messages")
    .select("type, content, conversation_id, conversations!inner(whatsapp_account_id)")
    .eq("business_id", businessId)
    .eq("id", messageId)
    .eq("direction", "inbound")
    .maybeSingle();
  const raw = (msg?.content as { raw?: { image?: { id?: string }; document?: { id?: string } } } | null)?.raw;
  const mediaId = raw?.image?.id ?? raw?.document?.id;
  const accountId = (msg?.conversations as unknown as { whatsapp_account_id: string | null } | null)?.whatsapp_account_id;
  if (!msg || !mediaId || !accountId) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const { wa } = await getClientForAccount(admin, businessId, accountId);
    const media = await wa.downloadMedia(mediaId);
    if (!ALLOWED_TYPES.test(media.mimeType)) return NextResponse.json({ error: "unsupported media type" }, { status: 415 });
    return new Response(media.bytes, {
      headers: {
        "content-type": media.mimeType,
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
        "content-disposition": media.mimeType === "application/pdf" ? "inline; filename=receipt.pdf" : "inline",
      },
    });
  } catch (err) {
    logger.warn("media.download_failed", { business_id: businessId, message_id: messageId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Media is no longer available from WhatsApp" }, { status: 502 });
  }
}
