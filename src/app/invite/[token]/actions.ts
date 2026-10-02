"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ACTIVE_BUSINESS_COOKIE, getSessionUser } from "@/lib/auth/session";
import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";

export async function acceptInvitationAction(token: string): Promise<{ error: string }> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return { error: "This invitation link is invalid." };

  const db = await createClient();
  const { data: businessId, error } = await db.rpc("accept_invitation", { p_token: token });
  if (error || !businessId) {
    logger.warn("team.accept_failed", { user_id: user.id, code: error?.code });
    const msg = error?.message ?? "";
    if (msg.includes("different email")) return { error: "This invitation was sent to a different email address. Sign in with that email to accept it." };
    if (msg.includes("expired")) return { error: "This invitation has expired. Ask for a new one." };
    if (msg.includes("already used")) return { error: "This invitation has already been used." };
    return { error: "This invitation link is invalid." };
  }

  (await cookies()).set(ACTIVE_BUSINESS_COOKIE, businessId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  logger.info("team.joined", { business_id: businessId, user_id: user.id });
  redirect("/dashboard");
}
