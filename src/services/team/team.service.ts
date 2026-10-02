import "server-only";

import { generateToken, hashToken } from "@/lib/security/tokens";
import type { DbClient } from "@/lib/supabase/types";
import { assertWithinLimit } from "@/services/billing/limits";

export class TeamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamError";
  }
}

export type TeamMember = {
  id: string;
  userId: string;
  role: "owner" | "admin" | "staff";
  permissions: string[];
  status: string;
  name: string | null;
  email: string | null;
  joinedAt: string;
};

export type PendingInvitation = {
  id: string;
  email: string;
  role: "owner" | "admin" | "staff";
  permissions: string[];
  expiresAt: string;
  expired: boolean;
};

export async function listTeam(db: DbClient, businessId: string, canManage: boolean) {
  const { data: members, error } = await db
    .from("business_members")
    .select("id, user_id, role, permissions, status, created_at")
    .eq("business_id", businessId)
    .neq("status", "disabled")
    .order("created_at");
  if (error) throw error;

  const { data: profiles } = await db
    .from("profiles")
    .select("id, full_name, email")
    .in("id", (members ?? []).map((m) => m.user_id));
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  const team: TeamMember[] = (members ?? []).map((m) => ({
    id: m.id,
    userId: m.user_id,
    role: m.role,
    permissions: m.permissions,
    status: m.status,
    name: byId.get(m.user_id)?.full_name ?? null,
    email: byId.get(m.user_id)?.email ?? null,
    joinedAt: m.created_at,
  }));

  let invitations: PendingInvitation[] = [];
  if (canManage) {
    const { data } = await db
      .from("business_invitations")
      .select("id, email, role, permissions, expires_at")
      .eq("business_id", businessId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false });
    const now = new Date();
    invitations = (data ?? []).map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      permissions: i.permissions,
      expiresAt: i.expires_at,
      expired: new Date(i.expires_at) < now,
    }));
  }

  return { members: team, invitations };
}

/**
 * Creates an invitation and returns the one-time accept URL. Only the token's
 * hash is stored; the URL is shown once to the inviter to share.
 */
export async function inviteMember(
  db: DbClient,
  params: {
    businessId: string;
    invitedBy: string;
    email: string;
    role: "admin" | "staff";
    permissions: string[];
    appUrl: string;
  },
): Promise<{ inviteUrl: string }> {
  const { members, invitations } = await listTeam(db, params.businessId, true);

  if (members.some((m) => m.email?.toLowerCase() === params.email)) {
    throw new TeamError("That person is already on your team.");
  }

  const seats = members.length + invitations.filter((i) => !i.expired).length;
  await assertWithinLimit(db, params.businessId, "staff", seats);

  // Replace an expired invitation for the same email.
  const stale = invitations.find((i) => i.email.toLowerCase() === params.email && i.expired);
  if (stale) await db.from("business_invitations").delete().eq("id", stale.id);

  const token = generateToken();
  const { error } = await db.from("business_invitations").insert({
    business_id: params.businessId,
    email: params.email,
    role: params.role,
    permissions: params.permissions,
    token_hash: hashToken(token),
    invited_by: params.invitedBy,
  });
  if (error) {
    if (error.code === "23505") throw new TeamError("There's already a pending invitation for that email.");
    if (error.code === "42501") throw new TeamError("You can't invite someone with that role.");
    throw error;
  }

  return { inviteUrl: `${params.appUrl.replace(/\/$/, "")}/invite/${token}` };
}

export async function updateMemberAccess(
  db: DbClient,
  businessId: string,
  memberId: string,
  access: { role: "admin" | "staff"; permissions: string[] },
) {
  const { data, error } = await db
    .from("business_members")
    .update({ role: access.role, permissions: access.permissions })
    .eq("business_id", businessId)
    .eq("id", memberId)
    .select("id");
  if (error?.code === "42501") throw new TeamError("Only the owner can grant admin access.");
  if (error) throw error;
  if (!data?.length) throw new TeamError("You can't change this member's access.");
}

export async function removeMember(db: DbClient, businessId: string, memberId: string) {
  const { data, error } = await db.from("business_members").delete().eq("business_id", businessId).eq("id", memberId).select("id");
  if (error) throw error;
  if (!data?.length) throw new TeamError("You can't remove this member.");
}

export async function revokeInvitation(db: DbClient, businessId: string, invitationId: string) {
  const { error } = await db.from("business_invitations").delete().eq("business_id", businessId).eq("id", invitationId);
  if (error) throw error;
}
