"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ACTIVE_BUSINESS_COOKIE, getBusinessContext } from "@/lib/auth/session";

export async function switchBusiness(form: FormData) {
  const businessId = form.get("businessId");
  const ctx = await getBusinessContext();
  if (!ctx || typeof businessId !== "string") redirect("/login");

  // Only honour businesses the user is actually a member of.
  if (!ctx.memberships.some((m) => m.businessId === businessId)) redirect("/dashboard");

  (await cookies()).set(ACTIVE_BUSINESS_COOKIE, businessId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/dashboard");
}
