"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/lib/actions";
import { AuthorizationError } from "@/lib/auth/errors";
import { authorize } from "@/lib/auth/session";
import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { businessProfileFromForm } from "@/lib/validation/business";
import { updateBusinessProfile } from "@/services/business/business.service";

export async function updateBusinessAction(_: FormState, form: FormData): Promise<FormState> {
  let ctx;
  try {
    ctx = await authorize("settings.manage");
  } catch (err) {
    if (err instanceof AuthorizationError) return { error: err.message };
    throw err;
  }

  const parsed = businessProfileFromForm(form);
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  try {
    await updateBusinessProfile(await createClient(), ctx.business.id, parsed.data);
  } catch (err) {
    logger.error("business.update_failed", err, { business_id: ctx.business.id });
    return { error: "Could not save changes." };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Business profile saved" };
}
