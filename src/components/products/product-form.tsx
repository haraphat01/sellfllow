"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/lib/action-types";
import { useFormAction } from "@/lib/use-form-action";

export type VariantDraft = {
  key: string;
  id?: string | null;
  name: string;
  options: string;
  sku: string;
  price: string;
  stock: string;
};

export type ProductFormDefaults = {
  name?: string;
  description?: string | null;
  sku?: string | null;
  price?: string;
  stock?: number;
  trackInventory?: boolean;
  status?: "active" | "draft" | "archived";
  category?: string | null;
  brand?: string | null;
  variants?: Omit<VariantDraft, "key">[];
};

function Card({ title, description, children, aside }: { title: string; description?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {aside}
      </div>
      <div className="grid gap-4 p-6">{children}</div>
    </section>
  );
}

let keySeq = 0;
const newKey = () => `v${++keySeq}`;

export function ProductForm({
  action,
  defaults = {},
  currency,
  categories,
  submitLabel,
  sidebar,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  defaults?: ProductFormDefaults;
  currency: string;
  categories: string[];
  submitLabel: string;
  sidebar?: React.ReactNode;
}) {
  const { state, pending, formProps } = useFormAction(action);
  const [trackInventory, setTrackInventory] = useState(defaults.trackInventory ?? true);
  const [variants, setVariants] = useState<VariantDraft[]>(() => (defaults.variants ?? []).map((v) => ({ ...v, key: newKey() })));
  const fe = state?.fieldErrors ?? {};
  const hasVariants = variants.length > 0;

  useEffect(() => {
    if (state?.ok) toast.success(state.message ?? "Saved");
    else if (state?.error) toast.error(state.error);
  }, [state]);

  const updateVariant = (key: string, patch: Partial<VariantDraft>) => setVariants((vs) => vs.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  const variantTotal = variants.reduce((sum, v) => sum + (Number.parseInt(v.stock, 10) || 0), 0);
  const variantError = (i: number, field: string) => fe[`variants.${i}.${field}`]?.[0];

  const serialisedVariants = JSON.stringify(
    variants.map(({ id, name, options, sku, price, stock }) => ({
      id: id ?? null,
      name,
      options,
      sku: sku || null,
      price: price || null,
      stock: stock === "" ? 0 : stock,
    })),
  );

  return (
    <form {...formProps} className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
      <input type="hidden" name="variants" value={serialisedVariants} />

      <div className="grid gap-6">
        <Card title="Product details" description="Customers see this through your AI agent — be accurate and specific.">
          <Field label="Name" name="name" defaultValue={defaults.name} placeholder="Black Leather Bag" required errors={fe.name} />
          <div className="grid gap-2">
            <Label htmlFor="f-description">Description</Label>
            <Textarea
              id="f-description"
              name="description"
              defaultValue={defaults.description ?? ""}
              rows={5}
              placeholder="Material, dimensions, what's included, care instructions…"
            />
            <p className="text-xs text-muted-foreground">The agent uses this to answer product questions. It won’t claim anything not written here.</p>
          </div>
        </Card>

        <Card title="Pricing & stock">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="f-price">Price ({currency})</Label>
              <Input id="f-price" name="price" inputMode="decimal" defaultValue={defaults.price} placeholder="45000" required aria-invalid={fe.price ? true : undefined} />
              {fe.price && <p className="text-xs text-destructive">{fe.price[0]}</p>}
            </div>
            <Field label="SKU" name="sku" defaultValue={defaults.sku ?? ""} placeholder="BAG-BLK-01" errors={fe.sku} />
          </div>

          <label className="flex items-center gap-2.5 text-sm">
            <Checkbox name="trackInventory" checked={trackInventory} onChange={(e) => setTrackInventory(e.target.checked)} />
            Track stock — the agent won’t sell more than you have
          </label>

          {trackInventory && !hasVariants && (
            <div className="grid max-w-[200px] gap-2">
              <Label htmlFor="f-stock">In stock</Label>
              <Input id="f-stock" name="stock" type="number" min={0} step={1} defaultValue={defaults.stock ?? 0} aria-invalid={fe.stock ? true : undefined} />
              {fe.stock && <p className="text-xs text-destructive">{fe.stock[0]}</p>}
            </div>
          )}
          {trackInventory && hasVariants && (
            <>
              <input type="hidden" name="stock" value={variantTotal} />
              <p className="text-sm text-muted-foreground">
                Stock is tracked per variant. Total: <span className="tabular font-medium text-foreground">{variantTotal}</span>
              </p>
            </>
          )}
        </Card>

        <Card
          title="Variants"
          description="Sizes, colours, storage options… each with its own stock and optional price."
          aside={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setVariants((vs) => [...vs, { key: newKey(), name: "", options: "", sku: "", price: "", stock: "0" }])}
            >
              <Plus /> Add variant
            </Button>
          }
        >
          {!hasVariants ? (
            <p className="text-sm text-muted-foreground">No variants. Add one if this product comes in different sizes, colours or models.</p>
          ) : (
            <div className="-mx-6 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-6 pb-2 font-medium">Name</th>
                    <th className="px-2 pb-2 font-medium">Options</th>
                    <th className="px-2 pb-2 font-medium">SKU</th>
                    <th className="w-28 px-2 pb-2 font-medium">Price</th>
                    <th className="w-20 px-2 pb-2 font-medium">Stock</th>
                    <th className="w-12 pr-6 pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v, i) => (
                    <tr key={v.key} className="align-top">
                      <td className="px-6 py-1.5">
                        <Input aria-label="Variant name" value={v.name} placeholder="Black / 42" onChange={(e) => updateVariant(v.key, { name: e.target.value })} aria-invalid={variantError(i, "name") ? true : undefined} />
                        {variantError(i, "name") && <p className="mt-1 text-xs text-destructive">{variantError(i, "name")}</p>}
                      </td>
                      <td className="px-2 py-1.5">
                        <Input aria-label="Options" value={v.options} placeholder="Color: Black, Size: 42" onChange={(e) => updateVariant(v.key, { options: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input aria-label="Variant SKU" value={v.sku} onChange={(e) => updateVariant(v.key, { sku: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input aria-label="Variant price" inputMode="decimal" value={v.price} placeholder="Same" onChange={(e) => updateVariant(v.key, { price: e.target.value })} aria-invalid={variantError(i, "price") ? true : undefined} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input aria-label="Variant stock" type="number" min={0} value={v.stock} onChange={(e) => updateVariant(v.key, { stock: e.target.value })} aria-invalid={variantError(i, "stock") ? true : undefined} />
                      </td>
                      <td className="pr-6 py-1.5">
                        <Button type="button" variant="ghost" size="icon" aria-label="Remove variant" onClick={() => setVariants((vs) => vs.filter((x) => x.key !== v.key))}>
                          <Trash2 className="text-muted-foreground" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:sticky lg:top-20">
        <Card title="Status">
          <NativeSelect name="status" defaultValue={defaults.status ?? "active"} aria-label="Status">
            <option value="active">Active — the agent can sell it</option>
            <option value="draft">Draft — hidden from the agent</option>
            <option value="archived">Archived</option>
          </NativeSelect>
        </Card>

        <Card title="Organisation">
          <div className="grid gap-2">
            <Label htmlFor="f-category">Category</Label>
            <Input id="f-category" name="category" list="product-categories" defaultValue={defaults.category ?? ""} placeholder="Bags" />
            <datalist id="product-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <Field label="Brand" name="brand" defaultValue={defaults.brand ?? ""} placeholder="Aisha" />
        </Card>

        {sidebar}

        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending && <Loader2 className="animate-spin" />} {submitLabel}
        </Button>
      </div>
    </form>
  );
}
