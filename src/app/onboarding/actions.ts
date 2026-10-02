"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/lib/actions";
import { ACTIVE_BUSINESS_COOKIE, getSessionUser } from "@/lib/auth/session";
import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { businessProfileFromForm } from "@/lib/validation/business";
import { createBusiness } from "@/services/business/business.service";

export async function createBusinessAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const parsed = businessProfileFromForm(form);
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  let businessId: string;
  try {
    businessId = await createBusiness(await createClient(), parsed.data);
  } catch (err) {
    logger.error("business.create_failed", err, { user_id: user.id });
    const msg = err instanceof Error && err.message.includes("business limit") ? "You have reached the maximum number of businesses." : "We couldn't create your business. Please try again.";
    return { error: msg };
  }

  (await cookies()).set(ACTIVE_BUSINESS_COOKIE, businessId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  logger.info("business.created", { business_id: businessId, user_id: user.id });
  redirect("/dashboard?welcome=1");
}
