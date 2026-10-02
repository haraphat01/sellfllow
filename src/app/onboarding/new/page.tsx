import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { BusinessProfileForm } from "@/components/business/business-profile-form";
import { requireUser } from "@/lib/auth/session";

import { createBusinessAction } from "../actions";

export const metadata: Metadata = { title: "New business" };

/** Additional businesses for users who already own/belong to one. */
export default async function NewBusinessPage() {
  await requireUser();
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/dashboard" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to dashboard
      </Link>
      <h1 className="mb-2 text-3xl font-semibold tracking-tight">Add another business</h1>
      <p className="mb-8 text-muted-foreground">Each business has its own WhatsApp number, catalogue, customers and billing.</p>
      <div className="rounded-xl border bg-card p-6 sm:p-8">
        <BusinessProfileForm action={createBusinessAction} submitLabel="Create business" />
      </div>
    </main>
  );
}
