import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/db/types/database";

import { AuthorizationError } from "./errors";
import { hasPermission, type MemberRole, type Permission } from "./permissions";

export const ACTIVE_BUSINESS_COOKIE = "sf_business";

export type SessionUser = {
  id: string;
  email: string;
  fullName: string | null;
  isPlatformAdmin: boolean;
};

export type BusinessContext = {
  user: SessionUser;
  business: Tables<"businesses">;
  role: MemberRole;
  permissions: string[];
  can: (perm: Permission) => boolean;
  memberships: { businessId: string; name: string; role: MemberRole }[];
};

/**
 * The signed-in user, verified server-side (JWT signature via getClaims).
 * Cached per request.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error) logger.warn("auth.get_claims_failed", { code: error.code, message: error.message });
  if (error || !sub) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, is_platform_admin")
    .eq("id", sub)
    .maybeSingle();

  return {
    id: sub,
    email: profile?.email ?? (data.claims.email as string | undefined) ?? "",
    fullName: profile?.full_name ?? null,
    isPlatformAdmin: profile?.is_platform_admin ?? false,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Resolves the active tenant for a dashboard request. The business id comes
 * from a cookie but is only honoured if the user is an active member (checked
 * through RLS); otherwise we fall back to the user's first business.
 */
export const getBusinessContext = cache(async (): Promise<BusinessContext | null> => {
  const user = await getSessionUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: members, error } = await supabase
    .from("business_members")
    .select("business_id, role, permissions, businesses!inner(*)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  // A failed query must not look like "no business" (that would bounce users to onboarding).
  if (error) throw new Error(`Could not load business context: ${error.message}`);
  if (!members?.length) return null;

  const wanted = (await cookies()).get(ACTIVE_BUSINESS_COOKIE)?.value;
  const active = members.find((m) => m.business_id === wanted) ?? members[0];
  const role = active.role as MemberRole;
  const permissions = active.permissions ?? [];

  return {
    user,
    business: active.businesses as unknown as Tables<"businesses">,
    role,
    permissions,
    can: (perm) => hasPermission(role, permissions, perm),
    memberships: members.map((m) => ({
      businessId: m.business_id,
      name: (m.businesses as unknown as Tables<"businesses">).name,
      role: m.role as MemberRole,
    })),
  };
});

/** For pages: redirects to onboarding when the user has no business yet. */
export async function requireBusinessContext(): Promise<BusinessContext> {
  await requireUser();
  const ctx = await getBusinessContext();
  if (!ctx) redirect("/onboarding");
  return ctx;
}

/** For server actions / route handlers: throws instead of redirecting. */
export async function authorize(perm?: Permission): Promise<BusinessContext> {
  const ctx = await getBusinessContext();
  if (!ctx) throw new AuthorizationError("Not signed in or no business selected.");
  if (ctx.business.status === "suspended") throw new AuthorizationError("This business is suspended.");
  if (perm && !ctx.can(perm)) throw new AuthorizationError();
  return ctx;
}

/** For admin server actions: throws instead of redirecting. */
export async function authorizePlatformAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user?.isPlatformAdmin) throw new AuthorizationError("Platform admins only.");
  return user;
}

export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isPlatformAdmin) redirect("/dashboard");
  return user;
}
