import "server-only";

import { randomInt } from "node:crypto";

import { logger } from "@/lib/observability/logger";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import type { DbClient } from "@/lib/supabase/types";
import { GraphApiError, whatsappClient, type WhatsAppClient } from "@/lib/whatsapp/graph";
import { assertWithinLimit } from "@/services/billing/limits";

export class WhatsAppConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppConnectionError";
  }
}

const credentialLabel = (phoneNumberId: string) => `token:${phoneNumberId}`;
const pinLabel = (phoneNumberId: string) => `pin:${phoneNumberId}`;

export async function listWhatsAppAccounts(db: DbClient, businessId: string) {
  const { data, error } = await db
    .from("whatsapp_accounts")
    .select("id, waba_id, phone_number_id, display_phone_number, verified_name, status, quality_rating, last_error, connected_at")
    .eq("business_id", businessId)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

async function storeCredential(admin: DbClient, businessId: string, label: string, secret: string) {
  const { data, error } = await admin
    .from("business_credentials")
    .upsert(
      {
        business_id: businessId,
        provider: "whatsapp",
        label,
        ciphertext: encryptSecret(secret, businessId),
        last_four: secret.slice(-4),
      },
      { onConflict: "business_id,provider,label" },
    )
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/**
 * Connects a WhatsApp number to a business after the caller has been
 * authorised (settings.manage). Uses the service-role client because
 * credentials are unreadable to users.
 *
 * `register`: Embedded Signup numbers must be registered for Cloud API with a
 * PIN; manually connected numbers are usually registered already.
 */
export async function connectWhatsAppAccount(
  admin: DbClient,
  params: { businessId: string; token: string; wabaId: string; phoneNumberId: string; register: boolean; requestId?: string },
) {
  const log = logger.child({ business_id: params.businessId, request_id: params.requestId, phone_number_id: params.phoneNumberId });

  const { data: existing } = await admin
    .from("whatsapp_accounts")
    .select("id, business_id, status")
    .eq("phone_number_id", params.phoneNumberId)
    .maybeSingle();
  if (existing && existing.business_id !== params.businessId) {
    throw new WhatsAppConnectionError("This WhatsApp number is already connected to another SellFlow business.");
  }

  if (!existing || existing.status !== "connected") {
    const { count } = await admin
      .from("whatsapp_accounts")
      .select("id", { count: "exact", head: true })
      .eq("business_id", params.businessId)
      .eq("status", "connected");
    await assertWithinLimit(admin, params.businessId, "whatsapp_numbers", count ?? 0);
  }

  const wa = whatsappClient(params.token);
  let info;
  try {
    info = await wa.getPhoneNumber(params.phoneNumberId);
  } catch (err) {
    log.warn("whatsapp.connect.phone_lookup_failed", { error: err instanceof Error ? err.message : String(err) });
    throw new WhatsAppConnectionError(
      err instanceof GraphApiError && err.isAuthError
        ? "Meta rejected the access token. Check it has whatsapp_business_messaging and whatsapp_business_management permissions."
        : "We couldn't find that phone number with this token. Check the Phone number ID.",
    );
  }

  try {
    await wa.subscribeApp(params.wabaId);
  } catch (err) {
    log.warn("whatsapp.connect.subscribe_failed", { error: err instanceof Error ? err.message : String(err) });
    throw new WhatsAppConnectionError("We couldn't subscribe to messages for this WhatsApp Business Account. Check the WABA ID and token permissions.");
  }

  let lastError: string | null = null;
  if (params.register) {
    const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
    try {
      await wa.registerPhoneNumber(params.phoneNumberId, pin);
      await storeCredential(admin, params.businessId, pinLabel(params.phoneNumberId), pin);
    } catch (err) {
      lastError = `Phone number registration failed: ${err instanceof Error ? err.message : String(err)}`;
      log.warn("whatsapp.connect.register_failed", { error: lastError });
    }
  }

  const credentialId = await storeCredential(admin, params.businessId, credentialLabel(params.phoneNumberId), params.token);

  const { data: account, error } = await admin
    .from("whatsapp_accounts")
    .upsert(
      {
        business_id: params.businessId,
        waba_id: params.wabaId,
        phone_number_id: params.phoneNumberId,
        display_phone_number: info.display_phone_number,
        verified_name: info.verified_name ?? null,
        quality_rating: info.quality_rating ?? null,
        status: lastError ? "error" : "connected",
        last_error: lastError,
        credential_id: credentialId,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "phone_number_id" },
    )
    .select("id, display_phone_number, status")
    .single();
  if (error) throw error;

  await admin.from("audit_logs").insert({
    business_id: params.businessId,
    actor_type: "user",
    action: "whatsapp.connected",
    entity_type: "whatsapp_account",
    entity_id: account.id,
    metadata: { phone_number_id: params.phoneNumberId, waba_id: params.wabaId, status: account.status },
    request_id: params.requestId ?? null,
  });
  log.info("whatsapp.connected", { whatsapp_account_id: account.id, status: account.status });
  return account;
}

export async function disconnectWhatsAppAccount(admin: DbClient, businessId: string, accountId: string) {
  const { data: account } = await admin
    .from("whatsapp_accounts")
    .select("id, waba_id, phone_number_id")
    .eq("business_id", businessId)
    .eq("id", accountId)
    .maybeSingle();
  if (!account) throw new WhatsAppConnectionError("WhatsApp number not found.");

  // Only unsubscribe if no other connected number of this business shares the WABA.
  const { count } = await admin
    .from("whatsapp_accounts")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("waba_id", account.waba_id)
    .eq("status", "connected")
    .neq("id", accountId);
  const client = await getClientForAccount(admin, businessId, accountId).catch(() => null);
  if (client && !count) {
    await client.wa.unsubscribeApp(account.waba_id).catch((err) => logger.warn("whatsapp.disconnect.unsubscribe_failed", { business_id: businessId, error: String(err) }));
  }

  await admin.from("whatsapp_accounts").update({ status: "disconnected", credential_id: null }).eq("id", accountId);
  await admin
    .from("business_credentials")
    .delete()
    .eq("business_id", businessId)
    .eq("provider", "whatsapp")
    .in("label", [credentialLabel(account.phone_number_id), pinLabel(account.phone_number_id)]);
  await admin.from("audit_logs").insert({ business_id: businessId, action: "whatsapp.disconnected", entity_type: "whatsapp_account", entity_id: accountId });
}

/** Decrypts the account's token and returns a Graph client. Service role only. */
export async function getClientForAccount(admin: DbClient, businessId: string, accountId: string): Promise<{ wa: WhatsAppClient; phoneNumberId: string }> {
  const { data: account } = await admin
    .from("whatsapp_accounts")
    .select("phone_number_id, status, credential_id")
    .eq("business_id", businessId)
    .eq("id", accountId)
    .maybeSingle();
  if (!account || account.status === "disconnected" || !account.credential_id) {
    throw new WhatsAppConnectionError("This WhatsApp number is not connected.");
  }
  const { data: cred } = await admin
    .from("business_credentials")
    .select("ciphertext")
    .eq("business_id", businessId)
    .eq("id", account.credential_id)
    .single();
  if (!cred) throw new WhatsAppConnectionError("WhatsApp credentials are missing. Reconnect the number.");
  return { wa: whatsappClient(decryptSecret(cred.ciphertext, businessId)), phoneNumberId: account.phone_number_id };
}
