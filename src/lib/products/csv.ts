import Papa from "papaparse";
import { z } from "zod";

import { parseMoneyToMinor, PRODUCT_STATUSES } from "./schema";

export const CSV_MAX_ROWS = 2000;
export const CSV_MAX_BYTES = 1_000_000;

export const CSV_TEMPLATE = [
  "name,sku,price,stock,category,brand,description,status",
  "Black Leather Bag,BAG-BLK-01,45000,20,Bags,Aisha,Handmade full-grain leather tote,active",
  "Brown Leather Belt,BELT-BRN-32,12500,35,Accessories,Aisha,,active",
].join("\n");

const HEADER_ALIASES: Record<string, string> = {
  name: "name",
  product: "name",
  "product name": "name",
  title: "name",
  sku: "sku",
  code: "sku",
  price: "price",
  "unit price": "price",
  amount: "price",
  stock: "stock",
  quantity: "stock",
  qty: "stock",
  inventory: "stock",
  "stock quantity": "stock",
  category: "category",
  brand: "brand",
  description: "description",
  status: "status",
};

function normaliseHeader(h: string) {
  const key = h.trim().toLowerCase().replace(/\(.*?\)/g, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return HEADER_ALIASES[key] ?? key;
}

const rowSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  sku: z.string().trim().max(64).optional().transform((v) => v || null),
  price: z.string().transform((v, ctx) => {
    const minor = parseMoneyToMinor(v);
    if (minor === null) {
      ctx.addIssue({ code: "custom", message: `invalid price "${v}"` });
      return z.NEVER;
    }
    return minor;
  }),
  stock: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v || !v.trim()) return 0;
      const n = Number(v.replace(/,/g, ""));
      if (!Number.isInteger(n) || n < 0) {
        ctx.addIssue({ code: "custom", message: `invalid stock "${v}"` });
        return z.NEVER;
      }
      return n;
    }),
  category: z.string().trim().max(80).optional().transform((v) => v || null),
  brand: z.string().trim().max(80).optional().transform((v) => v || null),
  description: z.string().trim().max(5000).optional().transform((v) => v || null),
  status: z
    .string()
    .optional()
    .transform((v, ctx) => {
      const s = (v ?? "").trim().toLowerCase() || "active";
      if (!(PRODUCT_STATUSES as readonly string[]).includes(s)) {
        ctx.addIssue({ code: "custom", message: `status must be active, draft or archived` });
        return z.NEVER;
      }
      return s as (typeof PRODUCT_STATUSES)[number];
    }),
});

export type ImportRow = {
  name: string;
  sku: string | null;
  price_minor: number;
  stock_quantity: number;
  category: string | null;
  brand: string | null;
  description: string | null;
  status: (typeof PRODUCT_STATUSES)[number];
};

export type CsvParseResult = {
  rows: ImportRow[];
  errors: { line: number; message: string }[];
  totalRows: number;
};

/** Parses and validates a product CSV. All-or-nothing: callers import only when errors is empty. */
export function parseProductCsv(text: string): CsvParseResult {
  if (text.length > CSV_MAX_BYTES) {
    return { rows: [], errors: [{ line: 0, message: "File is larger than 1 MB" }], totalRows: 0 };
  }

  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normaliseHeader,
  });

  // Spreadsheets often omit trailing empty cells; treat those as blank rather than errors.
  const errors: CsvParseResult["errors"] = parsed.errors
    .filter((e) => e.code !== "TooFewFields")
    .slice(0, 20)
    .map((e) => ({
      line: (e.row ?? 0) + 2,
      message: e.code === "TooManyFields" ? "too many columns — wrap values containing commas in quotes" : e.message,
    }));

  const fields = parsed.meta.fields ?? [];
  for (const required of ["name", "price"]) {
    if (!fields.includes(required)) errors.push({ line: 1, message: `Missing required column "${required}"` });
  }
  if (errors.some((e) => e.line === 1)) return { rows: [], errors, totalRows: parsed.data.length };

  if (parsed.data.length === 0) errors.push({ line: 0, message: "The file has no product rows" });
  if (parsed.data.length > CSV_MAX_ROWS) {
    errors.push({ line: 0, message: `Too many rows (${parsed.data.length}). The maximum is ${CSV_MAX_ROWS}.` });
    return { rows: [], errors, totalRows: parsed.data.length };
  }

  const rows: ImportRow[] = [];
  const seenSku = new Map<string, number>();

  parsed.data.forEach((raw, i) => {
    const line = i + 2;
    const r = rowSchema.safeParse(raw);
    if (!r.success) {
      errors.push({ line, message: r.error.issues.map((iss) => iss.message).join("; ") });
      return;
    }
    const v = r.data;
    if (v.sku) {
      const key = v.sku.toLowerCase();
      if (seenSku.has(key)) {
        errors.push({ line, message: `duplicate SKU "${v.sku}" (also on line ${seenSku.get(key)})` });
        return;
      }
      seenSku.set(key, line);
    }
    rows.push({
      name: v.name,
      sku: v.sku,
      price_minor: v.price,
      stock_quantity: v.stock,
      category: v.category,
      brand: v.brand,
      description: v.description,
      status: v.status,
    });
  });

  return { rows, errors: errors.slice(0, 50), totalRows: parsed.data.length };
}
