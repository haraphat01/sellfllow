"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { toActionError, type ActionResult, type FormState } from "@/lib/actions";
import { authorize } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { embeddedSignupSchema, manualConnectSchema, testMessageSchema } from "@/lib/validation/whatsapp";
import { exchangeSignupCode, GraphApiError } from "@/lib/whatsapp/graph";
import { connectWhatsAppAccount, disconnectWhatsAppAccount, WhatsAppConnectionError } from "@/services/whatsapp/accounts.service";
import { OutboundMessageError, sendTemplateToNumber } from "@/services/whatsapp/outbound.service";

function message(err: unknown, action: string) {
  if (err instanceof WhatsAppConnectionError || err instanceof OutboundMessageError) return err.message;
  if (err instanceof GraphApiError) return `Meta returned an error: ${err.message}`;
  if (err instanceof Error && err.message.startsWith("Missing required environment variable")) return "WhatsApp isn't configured on this SellFlow installation yet.";
  return toActionError(err, { action });
}

async function requestId() {
  return (await headers()).get("x-request-id") ?? crypto.randomUUID();
}

/** Called by the Embedded Signup popup. The code expires after ~30 seconds. */
export async function connectEmbeddedSignupAction(input: { code: string; wabaId: string; phoneNumberId: string }): Promise<ActionResult> {
  const parsed = embeddedSignupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Meta didn't return the details we need. Please try again." };
  try {
    const ctx = await authorize("settings.manage");
    const token = await exchangeSignupCode(parsed.data.code);
    const account = await connectWhatsAppAccount(createAdminClient(), {
      businessId: ctx.business.id,
      token,
      wabaId: parsed.data.wabaId,
      phoneNumberId: parsed.data.phoneNumberId,
      register: true,
      requestId: await requestId(),
    });
    revalidatePath("/settings/whatsapp");
    revalidatePath("/dashboard");
    return account.status === "connected"
      ? { ok: true, message: `Connected ${account.display_phone_number}` }
      : { ok: false, error: "Connected, but Meta couldn't register the number. See details on this page." };
  } catch (err) {
    return { ok: false, error: message(err, "whatsapp.connect.embedded") };
  }
}

/** Developer/advanced path: connect with a system-user token (e.g. before Tech Provider approval). */
export async function connectManualAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = manualConnectSchema.safeParse({
    wabaId: form.get("wabaId"),
    phoneNumberId: form.get("phoneNumberId"),
    accessToken: form.get("accessToken"),
  });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  try {
    const ctx = await authorize("settings.manage");
    if (ctx.role !== "owner" && ctx.role !== "admin") return { error: "Only owners and admins can connect with an access token." };
    const account = await connectWhatsAppAccount(createAdminClient(), {
      businessId: ctx.business.id,
      token: parsed.data.accessToken,
      wabaId: parsed.data.wabaId,
      phoneNumberId: parsed.data.phoneNumberId,
      register: false,
      requestId: await requestId(),
    });
    revalidatePath("/settings/whatsapp");
    revalidatePath("/dashboard");
    return { ok: true, message: `Connected ${account.display_phone_number}` };
  } catch (err) {
    return { error: message(err, "whatsapp.connect.manual") };
  }
}

export async function disconnectAction(accountId: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(accountId).success) return { ok: false, error: "Invalid request." };
  try {
    const ctx = await authorize("settings.manage");
    await disconnectWhatsAppAccount(createAdminClient(), ctx.business.id, accountId);
    revalidatePath("/settings/whatsapp");
    return { ok: true, message: "WhatsApp number disconnected" };
  } catch (err) {
    return { ok: false, error: message(err, "whatsapp.disconnect") };
  }
}

/** Sends Meta's pre-approved `hello_world` template — works outside the 24h window. */
export async function sendTestMessageAction(input: { accountId: string; to: string }): Promise<ActionResult> {
  const parsed = testMessageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid number." };
  try {
    const ctx = await authorize("settings.manage");
    await sendTemplateToNumber(createAdminClient(), {
      businessId: ctx.business.id,
      accountId: parsed.data.accountId,
      toWaId: parsed.data.to,
      template: { name: "hello_world", language: "en_US" },
      sender: "staff",
      senderUserId: ctx.user.id,
    });
    return { ok: true, message: "Test message sent. Reply to it from your phone to see it arrive." };
  } catch (err) {
    return { ok: false, error: message(err, "whatsapp.test") };
  }
}
