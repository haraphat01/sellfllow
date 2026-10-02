import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ProductForm } from "@/components/products/product-form";
import { requireBusinessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listCategories } from "@/services/products/products.service";

import { createProductAction } from "../actions";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const ctx = await requireBusinessContext();
  if (!ctx.can("products.manage")) redirect("/products");
  const categories = await listCategories(await createClient(), ctx.business.id);

  return (
    <>
      <Link href="/products" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Products
      </Link>
      <PageHeader title="New product" description="You can add images after saving." />
      <ProductForm action={createProductAction} currency={ctx.business.currency} categories={categories} submitLabel="Save product" />
    </>
  );
}
