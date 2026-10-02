import type { Metadata } from "next";
import { Building2, CheckCircle2, ShieldCheck } from "lucide-react";

import { SimpleAction } from "@/components/billing/plan-actions";
import { BankAccountForm } from "@/components/payments/bank-account-form";
import { Badge } from "@/components/ui/badge";
import { requireBusinessContext } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeCommission } from "@/services/payments/payouts.core";
import { arePayoutsAvailable, getCommission, getPayoutAccount, listBanks } from "@/services/payments/payouts.service";

import { connectPayoutAccountAction, disablePayoutAccountAction, verifyBankAccountAction } from "./actions";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsSettingsPage() {
  const ctx = await requireBusinessContext();
  if (!ctx.can("settings.manage")) {
    return <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">You don’t have permission to manage payments.</p>;
  }
  const admin = createAdminClient();
  const isOwner = ctx.role === "owner";
  const payoutsAvailable = arePayoutsAvailable();
  const [payout, commission, banks] = await Promise.all([
    getPayoutAccount(admin, ctx.business.id),
    getCommission(admin),
    payoutsAvailable && isOwner
      ? listBanks().catch((err) => {
          logger.warn("payouts.banks_unavailable", { error: err instanceof Error ? err.message : String(err) });
          return null;
        })
      : Promise.resolve(null),
  ]);
  const active = payoutsAvailable && payout?.status === "active";

  return (
    <div className="grid gap-6">
      <section className="rounded-xl border bg-card p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-3">
            <Building2 className="mt-0.5 size-5 text-primary" />
            <div>
              <h2 className="text-xl font-semibold">Get paid to your bank account</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Customers pay through secure Paystack checkout links sent on WhatsApp. Paystack settles your money straight to your bank account (usually the next working
                day) — SellFlow never holds it. Orders become Paid only when Paystack confirms the payment. Fee: {describeCommission(commission)}, plus Paystack’s standard
                processing fee.
              </p>
            </div>
          </div>
          {active ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="size-3.5" /> Receiving payments
            </Badge>
          ) : (
            <Badge variant="outline">Not set up</Badge>
          )}
        </div>

        {!active && (
          <p className="mt-4 text-sm text-[oklch(0.45_0.1_70)]">Until a bank account is added, the AI hands customers to your team to arrange payment.</p>
        )}

        {active && payout && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-sm">
            <div>
              <div className="font-medium">{payout.account_name}</div>
              <div className="text-muted-foreground">
                {payout.bank_name} •••• {payout.account_number_last4} · since {formatDate(payout.updated_at)}
              </div>
            </div>
            {isOwner && (
              <SimpleAction
                label="Turn off"
                destructive
                action={disablePayoutAccountAction}
                confirm={{ title: "Turn off payments?", description: "New payment links can't be created until you add a bank account again.", confirmLabel: "Turn off" }}
              />
            )}
          </div>
        )}

        <div className="mt-6 max-w-2xl">
          {!payoutsAvailable ? (
            <p className="text-sm text-muted-foreground">Payments aren’t available on this SellFlow installation yet.</p>
          ) : !isOwner ? (
            <p className="text-sm text-muted-foreground">Only the business owner can set where payments are sent.</p>
          ) : banks === null ? (
            <p className="text-sm text-destructive">We couldn’t load the list of banks from Paystack. Refresh to try again.</p>
          ) : (
            <>
              {active && <h3 className="mb-3 text-sm font-medium">Change account</h3>}
              <BankAccountForm banks={banks} replacing={active} verify={verifyBankAccountAction} connect={connectPayoutAccountAction} />
            </>
          )}
        </div>

        <ul className="mt-6 grid gap-2 border-t pt-5 text-sm text-muted-foreground">
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" /> The account is checked with your bank through Paystack before it’s used, and you’re notified whenever it changes.
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" /> Every payment is re-verified with Paystack before an order is marked paid.
          </li>
        </ul>
      </section>
    </div>
  );
}
