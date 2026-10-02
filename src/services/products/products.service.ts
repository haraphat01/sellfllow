import "server-only";

import type { ImportRow } from "@/lib/products/csv";
import { parseVariantOptions, type ProductInput } from "@/lib/products/schema";
import type { DbClient } from "@/lib/supabase/types";
import type { Tables } from "@/db/types/database";
import { assertWithinLimit } from "@/services/billing/limits";

import { PRODUCT_IMAGES_BUCKET } from "@/lib/products/images";
export const PAGE_SIZE = 25;

export class ProductError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductError";
  }
}

export type ProductListFilters = {
  q?: string;
  status?: "active" | "draft" | "archived" | "all";
  category?: string;
  stock?: "low" | "out";
  page?: number;
};

export type ProductListItem = Pick<
  Tables<"products">,
  "id" | "name" | "sku" | "price_minor" | "currency" | "stock_quantity" | "track_inventory" | "status" | "category" | "brand" | "updated_at"
> & { variant_count: number; image_path: string | null };

export const LOW_STOCK_THRESHOLD = 5;

/** Escape user text for use inside a PostgREST `or=(...ilike...)` filter. */
function ilikeTerm(q: string) {
  return q.replace(/[%_\\]/g, (c) => `\\${c}`).replace(/[,()"]/g, " ").trim();
}

export async function listProducts(db: DbClient, businessId: string, filters: ProductListFilters) {
  const page = Math.max(1, filters.page ?? 1);
  let query = db
    .from("products")
    .select(
      "id, name, sku, price_minor, currency, stock_quantity, track_inventory, status, category, brand, updated_at, product_variants(count), product_images(storage_path, position)",
      { count: "exact" },
    )
    .eq("business_id", businessId)
    .order("updated_at", { ascending: false })
    .order("position", { referencedTable: "product_images", ascending: true })
    .limit(1, { referencedTable: "product_images" })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const status = filters.status ?? "active";
  if (status === "all") query = query.neq("status", "archived");
  else query = query.eq("status", status);

  if (filters.category) query = query.eq("category", filters.category);
  if (filters.stock === "out") query = query.eq("track_inventory", true).eq("stock_quantity", 0);
  if (filters.stock === "low") query = query.eq("track_inventory", true).lte("stock_quantity", LOW_STOCK_THRESHOLD);

  const term = filters.q ? ilikeTerm(filters.q) : "";
  if (term) query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,brand.ilike.%${term}%`);

  const { data, count, error } = await query;
  if (error) throw error;

  const items: ProductListItem[] = (data ?? []).map((p) => {
    const { product_variants, product_images, ...rest } = p as typeof p & {
      product_variants: { count: number }[];
      product_images: { storage_path: string }[];
    };
    return { ...rest, variant_count: product_variants?.[0]?.count ?? 0, image_path: product_images?.[0]?.storage_path ?? null };
  });

  return { items, total: count ?? 0, page, pageCount: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)) };
}

export async function listCategories(db: DbClient, businessId: string): Promise<string[]> {
  const { data } = await db.from("products").select("category").eq("business_id", businessId).not("category", "is", null).limit(1000);
  return Array.from(new Set((data ?? []).map((r) => r.category as string))).sort((a, b) => a.localeCompare(b));
}

export async function getProduct(db: DbClient, businessId: string, productId: string) {
  const { data: product, error } = await db.from("products").select("*").eq("business_id", businessId).eq("id", productId).maybeSingle();
  if (error) throw error;
  if (!product) return null;

  const [variants, images] = await Promise.all([
    db.from("product_variants").select("*").eq("business_id", businessId).eq("product_id", productId).order("created_at"),
    db.from("product_images").select("*").eq("business_id", businessId).eq("product_id", productId).order("position"),
  ]);
  return { product, variants: variants.data ?? [], images: images.data ?? [] };
}

export async function getStockHistory(db: DbClient, businessId: string, productId: string, limit = 20) {
  const { data } = await db
    .from("inventory_movements")
    .select("id, delta, reason, variant_id, note, created_at, actor_user_id")
    .eq("business_id", businessId)
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

async function activeProductCount(db: DbClient, businessId: string) {
  const { count } = await db.from("products").select("id", { count: "exact", head: true }).eq("business_id", businessId).neq("status", "archived");
  return count ?? 0;
}

/** Products with variants hold the sum of variant stock (computed here, never trusted from the client). */
function totalStock(input: ProductInput) {
  return input.variants.length ? input.variants.reduce((sum, v) => sum + v.stock, 0) : input.stock;
}

function productRow(input: ProductInput) {
  return {
    name: input.name,
    description: input.description,
    sku: input.sku,
    price_minor: input.price,
    stock_quantity: totalStock(input),
    track_inventory: input.trackInventory,
    status: input.status,
    category: input.category,
    brand: input.brand,
  };
}

function mapUniqueViolation(error: { code?: string; message?: string }): never {
  if (error.code === "23505") throw new ProductError("That SKU is already used by another product or variant.");
  throw error;
}

export async function createProduct(db: DbClient, businessId: string, currency: string, input: ProductInput): Promise<string> {
  if (input.status !== "archived") await assertWithinLimit(db, businessId, "products", await activeProductCount(db, businessId));

  // With variants, stock is logged per variant: create the product at 0, add
  // the variants, then set the derived total (not logged once variants exist).
  const hasVariants = input.variants.length > 0;
  const { data, error } = await db
    .from("products")
    .insert({ ...productRow(input), stock_quantity: hasVariants ? 0 : input.stock, business_id: businessId, currency })
    .select("id")
    .single();
  if (error) mapUniqueViolation(error);

  if (hasVariants) {
    await syncVariants(db, businessId, data.id, input.variants);
    await db.from("products").update({ stock_quantity: totalStock(input) }).eq("business_id", businessId).eq("id", data.id);
  }
  return data.id;
}

export async function updateProduct(db: DbClient, businessId: string, productId: string, input: ProductInput) {
  const { data: existing } = await db.from("products").select("status").eq("business_id", businessId).eq("id", productId).maybeSingle();
  if (!existing) throw new ProductError("Product not found.");
  if (existing.status === "archived" && input.status !== "archived") {
    await assertWithinLimit(db, businessId, "products", await activeProductCount(db, businessId));
  }

  // Variants first, so the product-level stock change is logged only when the
  // product has no variants (see private.log_stock_change).
  await syncVariants(db, businessId, productId, input.variants);

  const { error } = await db.from("products").update(productRow(input)).eq("business_id", businessId).eq("id", productId);
  if (error) mapUniqueViolation(error);
}

/** Makes the product's variants match `variants`: update by id, insert new, delete the rest. */
async function syncVariants(db: DbClient, businessId: string, productId: string, variants: ProductInput["variants"]) {
  const { data: current } = await db.from("product_variants").select("id").eq("business_id", businessId).eq("product_id", productId);
  const currentIds = new Set((current ?? []).map((v) => v.id));
  const keepIds = new Set(variants.filter((v) => v.id && currentIds.has(v.id)).map((v) => v.id as string));

  const toDelete = [...currentIds].filter((id) => !keepIds.has(id));
  if (toDelete.length) {
    const { error } = await db.from("product_variants").delete().eq("business_id", businessId).in("id", toDelete);
    if (error) throw error;
  }

  for (const v of variants) {
    const row = {
      name: v.name,
      options: parseVariantOptions(v.options),
      sku: v.sku,
      price_minor: v.price,
      stock_quantity: v.stock,
    };
    const { error } =
      v.id && keepIds.has(v.id)
        ? await db.from("product_variants").update(row).eq("business_id", businessId).eq("id", v.id)
        : await db.from("product_variants").insert({ ...row, business_id: businessId, product_id: productId });
    if (error) mapUniqueViolation(error);
  }

}

export async function setProductStatus(db: DbClient, businessId: string, productId: string, status: "active" | "draft" | "archived") {
  if (status !== "archived") {
    const { data } = await db.from("products").select("status").eq("business_id", businessId).eq("id", productId).maybeSingle();
    if (data?.status === "archived") await assertWithinLimit(db, businessId, "products", await activeProductCount(db, businessId));
  }
  const { error } = await db.from("products").update({ status }).eq("business_id", businessId).eq("id", productId);
  if (error) throw error;
}

/** Hard delete. Past orders keep their item snapshots (name, price). */
export async function deleteProduct(db: DbClient, businessId: string, productId: string) {
  const { data: images } = await db.from("product_images").select("storage_path").eq("business_id", businessId).eq("product_id", productId);
  const { data, error } = await db.from("products").delete().eq("business_id", businessId).eq("id", productId).select("id");
  if (error) throw error;
  if (!data?.length) throw new ProductError("Product not found.");
  if (images?.length) await db.storage.from(PRODUCT_IMAGES_BUCKET).remove(images.map((i) => i.storage_path));
}

// ---------------------------------------------------------------------------
// Images: the browser uploads straight to Storage (RLS checks the business
// folder), then we record the object here after validating its path.
// ---------------------------------------------------------------------------
const IMAGE_PATH = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/;
export const MAX_IMAGES_PER_PRODUCT = 8;

export async function addProductImage(db: DbClient, businessId: string, productId: string, storagePath: string) {
  const m = IMAGE_PATH.exec(storagePath);
  if (!m || m[1] !== businessId || m[2] !== productId) throw new ProductError("Invalid image path.");

  const { count } = await db.from("product_images").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("product_id", productId);
  if ((count ?? 0) >= MAX_IMAGES_PER_PRODUCT) {
    await db.storage.from(PRODUCT_IMAGES_BUCKET).remove([storagePath]);
    throw new ProductError(`A product can have up to ${MAX_IMAGES_PER_PRODUCT} images.`);
  }

  const { error } = await db.from("product_images").insert({
    business_id: businessId,
    product_id: productId,
    storage_path: storagePath,
    position: count ?? 0,
  });
  if (error) throw error;
}

export async function removeProductImage(db: DbClient, businessId: string, imageId: string) {
  const { data, error } = await db.from("product_images").delete().eq("business_id", businessId).eq("id", imageId).select("storage_path");
  if (error) throw error;
  if (data?.[0]) await db.storage.from(PRODUCT_IMAGES_BUCKET).remove([data[0].storage_path]);
}

export async function makePrimaryImage(db: DbClient, businessId: string, productId: string, imageId: string) {
  const { data: images } = await db.from("product_images").select("id").eq("business_id", businessId).eq("product_id", productId).order("position");
  const ordered = [imageId, ...(images ?? []).map((i) => i.id).filter((id) => id !== imageId)];
  await Promise.all(ordered.map((id, position) => db.from("product_images").update({ position }).eq("business_id", businessId).eq("id", id)));
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------
export async function importProducts(db: DbClient, businessId: string, rows: ImportRow[]) {
  // Count how many rows would create new active products (SKU matches update in place).
  const skus = rows.map((r) => r.sku).filter((s): s is string => Boolean(s));
  const existing = new Set<string>();
  for (let i = 0; i < skus.length; i += 200) {
    const { data } = await db.from("products").select("sku").eq("business_id", businessId).in("sku", skus.slice(i, i + 200));
    (data ?? []).forEach((r) => r.sku && existing.add(r.sku));
  }
  const newActive = rows.filter((r) => r.status !== "archived" && !(r.sku && existing.has(r.sku))).length;
  if (newActive) await assertWithinLimit(db, businessId, "products", await activeProductCount(db, businessId), newActive);

  const { data, error } = await db.rpc("import_products", { p_business_id: businessId, p_rows: rows });
  if (error) {
    if (error.code === "23505") throw new ProductError("A SKU in the file is already used by a product variant.");
    throw error;
  }
  return data?.[0] ?? { inserted: 0, updated: 0 };
}
