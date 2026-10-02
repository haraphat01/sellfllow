import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { authorize } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { confirmBillingPayment } from "@/services/billing/billing.service";

export const metadata: Metadata = { title: "Payment" };

/**
 * Paystack returns here after checkout. The plan changes only if Paystack's
 * verify API confirms the charge (the query string proves nothing).
 */
export default async function BillingCompletePage({ searchParams }: PageProps<"/billing/complete">) {
  const ctx = await authorize("billing.manage");
  const sp = await searchParams;
  const reference = typeof sp.reference === "string" ? sp.reference.slice(0, 100) : typeof sp.trxref === "string" ? sp.trxref.slice(0, 100) : "";
  const res = reference ? await confirmBillingPayment(createAdminClient(), reference, { businessId: ctx.business.id }) : ({ outcome: "unknown" } as const);

  const view =
    res.outcome === "applied" || res.outcome === "already_paid"
      ? {
          icon: <CheckCircle2 className="size-10 text-success" />,
          title: res.kind === "renewal" ? "Subscription renewed" : `You're on ${"planName" in res && res.planName ? res.planName : "your new plan"}`,
          body: "Payment confirmed by Paystack. Your plan and limits are updated.",
        }
      : res.outcome === "pending"
        ? { icon: <Clock className="size-10 text-muted-foreground" />, title: "Waiting for Paystack", body: "We haven't received confirmation yet. If you completed payment, refresh in a minute — your plan updates automatically once Paystack confirms." }
        : res.outcome === "void_paid"
          ? { icon: <Clock className="size-10 text-muted-foreground" />, title: "Payment received", body: "This checkout had already been replaced by another payment. Our team will refund or credit it." }
          : { icon: <XCircle className="size-10 text-destructive" />, title: "Payment not completed", body: res.outcome === "failed" ? res.reason : "We couldn't find this payment." };

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      {view.icon}
      <h1 className="mt-4 text-xl font-semibold">{view.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{view.body}</p>
      <Button asChild className="mt-8">
        <Link href="/billing">Back to billing</Link>
      </Button>
    </div>
  );
}
