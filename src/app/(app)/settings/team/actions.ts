"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionResult } from "@/lib/actions";
import { authorize } from "@/lib/auth/session";
import { publicEnv } from "@/lib/env/public";
import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { inviteSchema, memberAccessSchema } from "@/lib/validation/team";
import { inviteMember, removeMember, revokeInvitation, updateMemberAccess } from "@/services/team/team.service";

const id = z.uuid();

export async function inviteMemberAction(input: {
  email: string;
  role: string;
  permissions: string[];
}): Promise<{ ok: true; inviteUrl: string } | { ok: false; error: string }> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid invitation." };

  try {
    const ctx = await authorize("staff.manage");
    if (parsed.data.role === "admin" && ctx.role !== "owner") return { ok: false, error: "Only the owner can invite admins." };
    const { inviteUrl } = await inviteMember(await createClient(), {
      businessId: ctx.business.id,
      invitedBy: ctx.user.id,
      email: parsed.data.email,
      role: parsed.data.role,
      permissions: parsed.data.permissions,
      appUrl: publicEnv.NEXT_PUBLIC_APP_URL,
    });
    logger.info("team.invited", { business_id: ctx.business.id, role: parsed.data.role });
    revalidatePath("/settings/team");
    return { ok: true, inviteUrl };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "team.invite" }) };
  }
}

export async function updateMemberAccessAction(memberId: string, input: { role: string; permissions: string[] }): Promise<ActionResult> {
  const parsed = memberAccessSchema.safeParse(input);
  if (!id.safeParse(memberId).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "Invalid request." };
  try {
    const ctx = await authorize("staff.manage");
    await updateMemberAccess(await createClient(), ctx.business.id, memberId, parsed.data);
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "team.update", member_id: memberId }) };
  }
  revalidatePath("/settings/team");
  return { ok: true, message: "Access updated" };
}

export async function removeMemberAction(memberId: string): Promise<ActionResult> {
  if (!id.safeParse(memberId).success) return { ok: false, error: "Invalid request." };
  try {
    const ctx = await authorize("staff.manage");
    await removeMember(await createClient(), ctx.business.id, memberId);
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "team.remove", member_id: memberId }) };
  }
  revalidatePath("/settings/team");
  return { ok: true, message: "Member removed" };
}

export async function revokeInvitationAction(invitationId: string): Promise<ActionResult> {
  if (!id.safeParse(invitationId).success) return { ok: false, error: "Invalid request." };
  try {
    const ctx = await authorize("staff.manage");
    await revokeInvitation(await createClient(), ctx.business.id, invitationId);
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "team.revoke" }) };
  }
  revalidatePath("/settings/team");
  return { ok: true, message: "Invitation revoked" };
}
