"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { toActionError, type ActionResult, type FormState } from "@/lib/actions";
import { authorize } from "@/lib/auth/session";
import { parseProductCsv, type CsvParseResult } from "@/lib/products/csv";
import { productInputFromForm } from "@/lib/products/schema";
import { createClient } from "@/lib/supabase/server";
import {
  addProductImage,
  createProduct,
  deleteProduct,
  importProducts,
  makePrimaryImage,
  removeProductImage,
  setProductStatus,
  updateProduct,
} from "@/services/products/products.service";

const id = z.uuid();

function flattenProductErrors(error: z.ZodError): Record<string, string[] | undefined> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path[0] === "variants" && issue.path.length > 1 ? `variants.${String(issue.path[1])}.${String(issue.path[2] ?? "")}` : String(issue.path[0] ?? "form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export async function createProductAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = productInputFromForm(form);
  if (!parsed.success) return { error: "Please fix the highlighted fields.", fieldErrors: flattenProductErrors(parsed.error) };

  let productId: string;
  try {
    const ctx = await authorize("products.manage");
    productId = await createProduct(await createClient(), ctx.business.id, ctx.business.currency, parsed.data);
  } catch (err) {
    return { error: toActionError(err, { action: "product.create" }) };
  }
  revalidatePath("/products");
  redirect(`/products/${productId}?created=1`);
}

export async function updateProductAction(productId: string, _: FormState, form: FormData): Promise<FormState> {
  if (!id.safeParse(productId).success) return { error: "Invalid product." };
  const parsed = productInputFromForm(form);
  if (!parsed.success) return { error: "Please fix the highlighted fields.", fieldErrors: flattenProductErrors(parsed.error) };

  try {
    const ctx = await authorize("products.manage");
    await updateProduct(await createClient(), ctx.business.id, productId, parsed.data);
  } catch (err) {
    return { error: toActionError(err, { action: "product.update", product_id: productId }) };
  }
  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  return { ok: true, message: "Product saved" };
}

export async function setProductStatusAction(productId: string, status: "active" | "draft" | "archived"): Promise<ActionResult> {
  if (!id.safeParse(productId).success || !["active", "draft", "archived"].includes(status)) return { ok: false, error: "Invalid request." };
  try {
    const ctx = await authorize("products.manage");
    await setProductStatus(await createClient(), ctx.business.id, productId, status);
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "product.status", product_id: productId }) };
  }
  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  return { ok: true, message: status === "archived" ? "Product archived" : "Product restored" };
}

export async function deleteProductAction(productId: string): Promise<ActionResult> {
  if (!id.safeParse(productId).success) return { ok: false, error: "Invalid product." };
  try {
    const ctx = await authorize("products.manage");
    await deleteProduct(await createClient(), ctx.business.id, productId);
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "product.delete", product_id: productId }) };
  }
  revalidatePath("/products");
  redirect("/products?deleted=1");
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------
export async function addProductImageAction(productId: string, storagePath: string): Promise<ActionResult> {
  if (!id.safeParse(productId).success || typeof storagePath !== "string") return { ok: false, error: "Invalid image." };
  try {
    const ctx = await authorize("products.manage");
    await addProductImage(await createClient(), ctx.business.id, productId, storagePath);
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "product.image.add", product_id: productId }) };
  }
  revalidatePath(`/products/${productId}`);
  revalidatePath("/products");
  return { ok: true };
}

export async function removeProductImageAction(productId: string, imageId: string): Promise<ActionResult> {
  if (!id.safeParse(productId).success || !id.safeParse(imageId).success) return { ok: false, error: "Invalid image." };
  try {
    const ctx = await authorize("products.manage");
    await removeProductImage(await createClient(), ctx.business.id, imageId);
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "product.image.remove", product_id: productId }) };
  }
  revalidatePath(`/products/${productId}`);
  revalidatePath("/products");
  return { ok: true, message: "Image removed" };
}

export async function makePrimaryImageAction(productId: string, imageId: string): Promise<ActionResult> {
  if (!id.safeParse(productId).success || !id.safeParse(imageId).success) return { ok: false, error: "Invalid image." };
  try {
    const ctx = await authorize("products.manage");
    await makePrimaryImage(await createClient(), ctx.business.id, productId, imageId);
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "product.image.primary", product_id: productId }) };
  }
  revalidatePath(`/products/${productId}`);
  revalidatePath("/products");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// CSV import: preview validates without writing; import re-parses server-side.
// ---------------------------------------------------------------------------
export type ImportPreview = Pick<CsvParseResult, "errors" | "totalRows"> & {
  sample: CsvParseResult["rows"];
  validRows: number;
};

export async function previewImportAction(csv: string): Promise<{ ok: true; preview: ImportPreview } | { ok: false; error: string }> {
  try {
    await authorize("products.manage");
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
  if (typeof csv !== "string") return { ok: false, error: "Invalid file." };
  const result = parseProductCsv(csv);
  return {
    ok: true,
    preview: { errors: result.errors, totalRows: result.totalRows, validRows: result.rows.length, sample: result.rows.slice(0, 8) },
  };
}

export async function importProductsAction(csv: string): Promise<ActionResult> {
  if (typeof csv !== "string") return { ok: false, error: "Invalid file." };
  const result = parseProductCsv(csv);
  if (result.errors.length || !result.rows.length) return { ok: false, error: "Fix the errors in your file and try again." };

  try {
    const ctx = await authorize("products.manage");
    const { inserted, updated } = await importProducts(await createClient(), ctx.business.id, result.rows);
    revalidatePath("/products");
    return { ok: true, message: `Imported ${inserted} new and updated ${updated} existing product${inserted + updated === 1 ? "" : "s"}.` };
  } catch (err) {
    return { ok: false, error: toActionError(err, { action: "product.import", rows: result.rows.length }) };
  }
}
