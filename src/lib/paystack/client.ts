import "server-only";

import { serverEnv } from "@/lib/env/server";

/** Minimal Paystack API client. One instance per secret key (per business). */

export class PaystackError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "PaystackError";
  }
}

export type PaystackTransaction = {
  id: number;
  status: "success" | "failed" | "abandoned" | "ongoing" | "pending" | "processing" | "queued" | "reversed";
  reference: string;
  amount: number;
  currency: string;
  paid_at: string | null;
  channel: string | null;
  gateway_response: string | null;
  metadata: Record<string, unknown> | string | null;
  /** Present for card payments; `reusable` cards can be charged again (renewals). */
  authorization?: {
    authorization_code?: string;
    reusable?: boolean;
    last4?: string;
    exp_month?: string;
    exp_year?: string;
    card_type?: string;
    brand?: string;
    channel?: string;
  } | null;
  customer?: { email?: string; customer_code?: string } | null;
  /** Present when the transaction was split to a subaccount. */
  subaccount?: { subaccount_code?: string } | null;
};

function baseUrl() {
  const env = serverEnv();
  return process.env.NODE_ENV !== "production" && env.PAYSTACK_BASE_URL ? env.PAYSTACK_BASE_URL.replace(/\/$/, "") : "https://api.paystack.co";
}

export function paystackMode(secretKey: string): "test" | "live" | "unknown" {
  return secretKey.startsWith("sk_test_") ? "test" : secretKey.startsWith("sk_live_") ? "live" : "unknown";
}

export function paystackClient(secretKey: string) {
  async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${secretKey}`, ...(init.body ? { "content-type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; code?: string; data?: T };
    if (!res.ok || json.status === false) throw new PaystackError(json.message ?? `Paystack request failed (${res.status})`, res.status, json.code);
    return json.data as T;
  }

  return {
    /** Cheap authenticated call used to validate a key. */
    checkKey: () => call<{ currency: string; balance: number }[]>("/balance"),

    initialize: (p: {
      email: string;
      amountMinor: number;
      currency: string;
      reference: string;
      callbackUrl?: string;
      metadata?: Record<string, unknown>;
      /** Split to a subaccount: Paystack settles to its bank; `transactionChargeMinor` stays with the main account. */
      split?: { subaccount: string; transactionChargeMinor: number; bearer: "account" | "subaccount" };
    }) =>
      call<{ authorization_url: string; access_code: string; reference: string }>("/transaction/initialize", {
        method: "POST",
        body: {
          email: p.email,
          amount: p.amountMinor,
          currency: p.currency,
          reference: p.reference,
          ...(p.callbackUrl ? { callback_url: p.callbackUrl } : {}),
          ...(p.split
            ? { subaccount: p.split.subaccount, bearer: p.split.bearer, ...(p.split.transactionChargeMinor > 0 ? { transaction_charge: p.split.transactionChargeMinor } : {}) }
            : {}),
          metadata: p.metadata ?? {},
        },
      }),

    /** Nigerian banks that can receive settlements (NUBAN). */
    listBanks: () => call<{ name: string; code: string; active: boolean; currency: string; type: string }[]>("/bank?country=nigeria&currency=NGN&perPage=100"),

    /** Account-name lookup: proves the account exists and whose it is. */
    resolveAccount: (accountNumber: string, bankCode: string) =>
      call<{ account_number: string; account_name: string }>(`/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`),

    createSubaccount: (p: { businessName: string; bankCode: string; accountNumber: string; percentageCharge: number; description?: string; email?: string }) =>
      call<{ subaccount_code: string; settlement_bank: string; account_number: string }>("/subaccount", {
        method: "POST",
        body: {
          business_name: p.businessName,
          settlement_bank: p.bankCode,
          account_number: p.accountNumber,
          percentage_charge: p.percentageCharge,
          ...(p.description ? { description: p.description } : {}),
          ...(p.email ? { primary_contact_email: p.email } : {}),
        },
      }),

    updateSubaccount: (code: string, p: { businessName?: string; bankCode?: string; accountNumber?: string; active?: boolean }) =>
      call<{ subaccount_code: string }>(`/subaccount/${encodeURIComponent(code)}`, {
        method: "PUT",
        body: {
          ...(p.businessName ? { business_name: p.businessName } : {}),
          ...(p.bankCode ? { settlement_bank: p.bankCode } : {}),
          ...(p.accountNumber ? { account_number: p.accountNumber } : {}),
          ...(p.active !== undefined ? { active: p.active } : {}),
        },
      }),

    verify: (reference: string) => call<PaystackTransaction>(`/transaction/verify/${encodeURIComponent(reference)}`),

    /** Charges a saved reusable card (server-to-server). The result still has to be checked. */
    chargeAuthorization: (p: { authorizationCode: string; email: string; amountMinor: number; currency: string; reference: string; metadata?: Record<string, unknown> }) =>
      call<PaystackTransaction>("/transaction/charge_authorization", {
        method: "POST",
        body: {
          authorization_code: p.authorizationCode,
          email: p.email,
          amount: p.amountMinor,
          currency: p.currency,
          reference: p.reference,
          metadata: p.metadata ?? {},
        },
      }),

    refund: (reference: string, amountMinor?: number) =>
      call<{ status: string; transaction: { reference: string } }>("/refund", { method: "POST", body: { transaction: reference, ...(amountMinor ? { amount: amountMinor } : {}) } }),
  };
}

export type PaystackClient = ReturnType<typeof paystackClient>;
