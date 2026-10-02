import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";

import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = { title: "Payment" };

/**
 * Where Paystack returns the customer after checkout. This page never marks
 * anything as paid — confirmation comes from Paystack's signed webhook plus a
 * server-side verification, and the customer is told on WhatsApp.
 */
export default function PaymentCompletePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <Logo className="mb-10" />
      <CheckCircle2 className="mb-4 size-10 text-success" />
      <h1 className="text-xl font-semibold">Thanks — we’re confirming your payment</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        As soon as Paystack confirms it, you’ll get a message on WhatsApp. You can close this page and return to your chat.
      </p>
    </main>
  );
}
