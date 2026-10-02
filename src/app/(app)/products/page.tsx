import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ImageIcon, Package, Plus, Search, Upload } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { requireBusinessContext } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { productImageUrl } from "@/lib/products/images";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { LOW_STOCK_THRESHOLD, listCategories, listProducts, type ProductListFilters } from "@/services/products/products.service";

export const metadata: Metadata = { title: "Products" };

const STATUS_TABS = [
  { value: "active", label: "Active" },
  { value: "draft", label: "Drafts" },
  { value: "archived", label: "Archived" },
] as const;

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function StockBadge({ track, qty }: { track: boolean; qty: number }) {
  if (!track) return <span className="text-muted-foreground">Not tracked</span>;
  if (qty === 0) return <Badge variant="destructive">Out of stock</Badge>;
  if (qty <= LOW_STOCK_THRESHOLD) return <Badge variant="warning">{qty} left</Badge>;
  return <span className="tabular">{qty.toLocaleString()}</span>;
}

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const ctx = await requireBusinessContext();
  const sp = await searchParams;
  const filters: ProductListFilters = {
    q: one(sp.q)?.slice(0, 100),
    status: (STATUS_TABS.some((t) => t.value === one(sp.status)) ? one(sp.status) : "active") as ProductListFilters["status"],
    category: one(sp.category) || undefined,
    stock: one(sp.stock) === "low" || one(sp.stock) === "out" ? (one(sp.stock) as "low" | "out") : undefined,
    page: Number(one(sp.page)) || 1,
  };

  const db = await createClient();
  const [{ items, total, page, pageCount }, categories] = await Promise.all([
    listProducts(db, ctx.business.id, filters),
    listCategories(db, ctx.business.id),
  ]);
  const canManage = ctx.can("products.manage");
  const filtered = Boolean(filters.q || filters.category || filters.stock);

  const href = (patch: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const merged = { q: filters.q, status: filters.status, category: filters.category, stock: filters.stock, page: undefined, ...patch };
    Object.entries(merged).forEach(([k, v]) => {
      if (v !== undefined && v !== "" && !(k === "status" && v === "active") && !(k === "page" && Number(v) === 1)) params.set(k, String(v));
    });
    const qs = params.toString();
    return qs ? `/products?${qs}` : "/products";
  };

  const isEmptyCatalogue = total === 0 && !filtered && filters.status === "active";

  return (
    <>
      <PageHeader
        title="Products"
        description="Your AI agent quotes prices and availability only from this catalogue."
        actions={
          canManage && (
            <>
              <Button variant="outline" asChild>
                <Link href="/products/import">
                  <Upload /> Import CSV
                </Link>
              </Button>
              <Button asChild>
                <Link href="/products/new">
                  <Plus /> Add product
                </Link>
              </Button>
            </>
          )
        }
      />

      {isEmptyCatalogue ? (
        <EmptyState
          icon={Package}
          title="Your catalogue is empty"
          description="Add products one by one or import a spreadsheet. Include price and stock so the agent can answer “how much?” and “is it available?” accurately."
          action={
            canManage && (
              <div className="flex gap-2">
                <Button variant="outline" asChild>
                  <Link href="/products/import">
                    <Upload /> Import CSV
                  </Link>
                </Button>
                <Button asChild>
                  <Link href="/products/new">
                    <Plus /> Add product
                  </Link>
                </Button>
              </div>
            )
          }
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <nav className="flex rounded-lg border bg-card p-0.5 text-sm">
              {STATUS_TABS.map((t) => (
                <Link
                  key={t.value}
                  href={href({ status: t.value })}
                  className={cn("rounded-md px-3 py-1.5", filters.status === t.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {t.label}
                </Link>
              ))}
            </nav>
            <form className="flex flex-1 flex-wrap items-center gap-2" action="/products">
              {filters.status !== "active" && <input type="hidden" name="status" value={filters.status} />}
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input name="q" defaultValue={filters.q} placeholder="Search name, SKU or brand" className="pl-8" />
              </div>
              <NativeSelect name="category" defaultValue={filters.category ?? ""} className="w-44" aria-label="Category">
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </NativeSelect>
              <NativeSelect name="stock" defaultValue={filters.stock ?? ""} className="w-36" aria-label="Stock">
                <option value="">Any stock</option>
                <option value="low">Low stock</option>
                <option value="out">Out of stock</option>
              </NativeSelect>
              <Button type="submit" variant="secondary">
                Filter
              </Button>
              {filtered && (
                <Button variant="ghost" asChild>
                  <Link href={href({ q: undefined, category: undefined, stock: undefined })}>Clear</Link>
                </Button>
              )}
            </form>
          </div>

          {items.length === 0 ? (
            <EmptyState icon={Search} title="No products match" description="Try a different search or clear the filters." />
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 text-right font-medium">Price</th>
                    <th className="px-4 py-3 text-right font-medium">Stock</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((p) => (
                    <tr key={p.id} className="group hover:bg-muted/40">
                      <td className="px-4 py-2.5">
                        <Link href={`/products/${p.id}`} className="flex items-center gap-3">
                          <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                            {p.image_path ? (
                              <Image src={productImageUrl(p.image_path)} alt="" fill sizes="40px" className="object-cover" />
                            ) : (
                              <ImageIcon className="size-4 text-muted-foreground" />
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium group-hover:underline">{p.name}</span>
                            <span className="block text-xs text-muted-foreground">
                              {[p.sku, p.variant_count ? `${p.variant_count} variant${p.variant_count === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || "—"}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{p.category ?? "—"}</td>
                      <td className="tabular px-4 py-2.5 text-right">{formatMoney(p.price_minor, p.currency)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <StockBadge track={p.track_inventory} qty={p.stock_quantity} />
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={p.status === "active" ? "success" : "secondary"} className="capitalize">
                          {p.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {total.toLocaleString()} product{total === 1 ? "" : "s"} · page {page} of {pageCount}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild={page > 1} disabled={page <= 1}>
                  {page > 1 ? (
                    <Link href={href({ page: page - 1 })}>
                      <ChevronLeft /> Previous
                    </Link>
                  ) : (
                    <span>
                      <ChevronLeft /> Previous
                    </span>
                  )}
                </Button>
                <Button variant="outline" size="sm" asChild={page < pageCount} disabled={page >= pageCount}>
                  {page < pageCount ? (
                    <Link href={href({ page: page + 1 })}>
                      Next <ChevronRight />
                    </Link>
                  ) : (
                    <span>
                      Next <ChevronRight />
                    </span>
                  )}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
