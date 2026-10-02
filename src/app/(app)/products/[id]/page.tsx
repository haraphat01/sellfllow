import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ProductActions } from "@/components/products/product-actions";
import { ProductForm } from "@/components/products/product-form";
import { ProductImages } from "@/components/products/product-images";
import { ProductSummary } from "@/components/products/product-summary";
import { Badge } from "@/components/ui/badge";
import { requireBusinessContext } from "@/lib/auth/session";
import { formatVariantOptions } from "@/lib/products/schema";
import { createClient } from "@/lib/supabase/server";
import { getProduct, getStockHistory, listCategories } from "@/services/products/products.service";

import { updateProductAction } from "../actions";

export const metadata: Metadata = { title: "Product" };

const REASON_LABEL: Record<string, string> = {
  manual_adjustment: "Manual edit",
  import: "CSV import",
  restock: "Initial stock",
  order_reserved: "Order reserved",
  order_released: "Order released",
  order_fulfilled: "Order fulfilled",
};

const minorToInput = (minor: number | null) => (minor === null ? "" : (minor / 100).toString());

export default async function ProductPage({ params }: PageProps<"/products/[id]">) {
  const { id } = await params;
  const ctx = await requireBusinessContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const db = await createClient();
  const [data, categories, history] = await Promise.all([
    getProduct(db, ctx.business.id, id),
    listCategories(db, ctx.business.id),
    ctx.can("products.manage") ? getStockHistory(db, ctx.business.id, id) : Promise.resolve([]),
  ]);
  if (!data) notFound();
  const { product, variants, images } = data;
  const canManage = ctx.can("products.manage");
  const variantName = new Map(variants.map((v) => [v.id, v.name]));

  return (
    <>
      <Link href="/products" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Products
      </Link>
      <PageHeader
        title={product.name}
        description={product.sku ? `SKU ${product.sku}` : undefined}
        actions={
          <>
            <Badge variant={product.status === "active" ? "success" : "secondary"} className="capitalize">
              {product.status}
            </Badge>
            {canManage && <ProductActions productId={product.id} name={product.name} status={product.status} />}
          </>
        }
      />

      {!canManage ? (
        <ProductSummary product={product} variants={variants} images={images} />
      ) : (
        <div className="grid gap-6">
          <ProductForm
            action={updateProductAction.bind(null, product.id)}
            currency={product.currency}
            categories={categories}
            submitLabel="Save changes"
            defaults={{
              name: product.name,
              description: product.description,
              sku: product.sku,
              price: minorToInput(product.price_minor),
              stock: product.stock_quantity,
              trackInventory: product.track_inventory,
              status: product.status,
              category: product.category,
              brand: product.brand,
              variants: variants.map((v) => ({
                id: v.id,
                name: v.name,
                options: formatVariantOptions(v.options as Record<string, unknown>),
                sku: v.sku ?? "",
                price: minorToInput(v.price_minor),
                stock: String(v.stock_quantity),
              })),
            }}
          />

          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <ProductImages businessId={ctx.business.id} productId={product.id} images={images} productName={product.name} />

            <section className="rounded-xl border bg-card">
              <div className="border-b px-6 py-4">
                <h2 className="font-semibold">Stock history</h2>
              </div>
              {history.length === 0 ? (
                <p className="px-6 py-5 text-sm text-muted-foreground">No stock movements yet.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {history.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 px-6 py-2.5">
                      <div className="min-w-0">
                        <div>{REASON_LABEL[m.reason] ?? m.reason}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {m.variant_id ? `${variantName.get(m.variant_id) ?? "Variant"} · ` : ""}
                          {new Date(m.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                        </div>
                      </div>
                      <span className={m.delta > 0 ? "tabular font-medium text-success" : "tabular font-medium text-destructive"}>
                        {m.delta > 0 ? `+${m.delta}` : m.delta}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
