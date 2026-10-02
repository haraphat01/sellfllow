import Image from "next/image";

import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { productImageUrl } from "@/lib/products/images";
import { formatVariantOptions } from "@/lib/products/schema";
import type { Tables } from "@/db/types/database";

/** Read-only product view for team members who can't edit the catalogue (e.g. sales agents). */
export function ProductSummary({
  product,
  variants,
  images,
}: {
  product: Tables<"products">;
  variants: Tables<"product_variants">[];
  images: Tables<"product_images">[];
}) {
  const stockLabel = (qty: number) => (!product.track_inventory ? "Not tracked" : qty === 0 ? "Out of stock" : `${qty} in stock`);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
      <section className="rounded-xl border bg-card p-6">
        <dl className="grid gap-5 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-muted-foreground">Price</dt>
            <dd className="tabular mt-1 text-xl font-semibold">{formatMoney(product.price_minor, product.currency)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Stock</dt>
            <dd className="mt-1 text-xl font-semibold">{stockLabel(product.stock_quantity)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Category</dt>
            <dd className="mt-1 text-xl font-semibold">{product.category ?? "—"}</dd>
          </div>
        </dl>
        {product.description && <p className="mt-6 text-sm leading-relaxed whitespace-pre-line">{product.description}</p>}

        {variants.length > 0 && (
          <table className="mt-6 w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Variant</th>
                <th className="py-2 font-medium">Options</th>
                <th className="py-2 text-right font-medium">Price</th>
                <th className="py-2 text-right font-medium">Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {variants.map((v) => (
                <tr key={v.id}>
                  <td className="py-2 font-medium">{v.name}</td>
                  <td className="py-2 text-muted-foreground">{formatVariantOptions(v.options as Record<string, unknown>) || "—"}</td>
                  <td className="tabular py-2 text-right">{formatMoney(v.price_minor ?? product.price_minor, product.currency)}</td>
                  <td className="py-2 text-right">
                    {product.track_inventory && v.stock_quantity === 0 ? <Badge variant="destructive">Out</Badge> : <span className="tabular">{v.stock_quantity}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {images.length > 0 && (
        <section className="grid grid-cols-3 gap-2 rounded-xl border bg-card p-4 lg:grid-cols-2">
          {images.map((img) => (
            <div key={img.id} className="relative aspect-square overflow-hidden rounded-lg border bg-muted">
              <Image src={productImageUrl(img.storage_path)} alt={img.alt ?? product.name} fill sizes="160px" className="object-cover" />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
