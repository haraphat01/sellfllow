import type { Metadata } from "next";
import { Megaphone } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireBusinessContext } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Campaigns" };

export default async function Page() {
  await requireBusinessContext();
  return (
    <>
      <PageHeader title="Campaigns" description="Targeted, consent-aware WhatsApp campaigns to customer segments." />
      <EmptyState icon={Megaphone} title="No campaigns yet" description="Send approved WhatsApp templates to segments such as repeat customers or people who asked about a product." />
    </>
  );
}
