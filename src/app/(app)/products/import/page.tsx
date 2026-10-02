import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { CsvImport } from "@/components/products/csv-import";
import { requireBusinessContext } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Import products" };

export default async function ImportPage() {
  const ctx = await requireBusinessContext();
  if (!ctx.can("products.manage")) redirect("/products");
  return (
    <>
      <Link href="/products" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Products
      </Link>
      <PageHeader title="Import products" description="Bulk-add or update your catalogue from a spreadsheet. Nothing is imported until every row is valid." />
      <CsvImport currency={ctx.business.currency} />
    </>
  );
}
