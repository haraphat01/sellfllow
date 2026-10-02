"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionResult, type FormState } from "@/lib/actions";
import { authorize } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { addTag, customerUpdateSchema, removeTag, tagSchema, updateCustomer } from "@/services/customers/customers.service";

const id = z.uuid();

function refresh(customerId: string) {
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  revalidatePath("/conversations", "layout");
}

export async function updateCustomerAction(customerId: string, _: FormState, form: FormData): Promise<FormState> {
  if (!id.safeParse(customerId).success) return { error: "Invalid customer." };
  const parsed = customerUpdateSchema.safeParse({
    name: form.get("name") ?? "",
    email: form.get("email") ?? "",
    address: form.get("address") ?? "",
    notes: form.get("notes") ?? "",
    status: form.get("status"),
  });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  try {
    const ctx = await authorize("customers.manage");
    await updateCustomer(await createClient(), ctx.business.id, customerId, parsed.data);
    refresh(customerId);
    return { ok: true, message: "Customer saved" };
  } catch (err) {
    return { error: toActionError(err, { action: "customer.update", customer_id: customerId }) };
  }
}

export async function addTagAction(customerId: string, tag: string): Promise<ActionResult> {
  const parsed = tagSchema.safeParse(tag);
  if (!id.safeParse(customerId).success) return { ok: false, error: "Invalid customer." };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid tag." };
  try {
    const ctx = await authorize("customers.manage");
    await addTag(await createClient(), ctx.business.id, customerId, parsed.data);
    refresh(customerId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "customer.tag.add" }) };
  }
}

export async function removeTagAction(customerId: string, tag: string): Promise<ActionResult> {
  if (!id.safeParse(customerId).success || typeof tag !== "string") return { ok: false, error: "Invalid request." };
  try {
    const ctx = await authorize("customers.manage");
    await removeTag(await createClient(), ctx.business.id, customerId, tag);
    refresh(customerId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "customer.tag.remove" }) };
  }
}
