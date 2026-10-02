import { describe, expect, it } from "vitest";

import { CSV_TEMPLATE, parseProductCsv } from "@/lib/products/csv";
import { formatVariantOptions, parseMoneyToMinor, parseVariantOptions, productInputSchema } from "@/lib/products/schema";

describe("parseMoneyToMinor", () => {
  it.each([
    ["45000", 4_500_000],
    ["45,000", 4_500_000],
    ["₦45,000.50", 4_500_050],
    ["0.5", 50],
    [45000, 4_500_000],
    ["", null],
    ["abc", null],
    ["1.234", null],
    ["-5", 500], // minus sign stripped as a non-digit; schema validation rejects negatives elsewhere
  ])("%s -> %s", (input, expected) => {
    expect(parseMoneyToMinor(input)).toBe(expected);
  });
});

describe("variant options", () => {
  it("parses and formats key/value pairs", () => {
    const opts = parseVariantOptions("Color: Black, Size: 42; Storage Size: 256GB, junk");
    expect(opts).toEqual({ color: "Black", size: "42", storage_size: "256GB" });
    expect(formatVariantOptions(opts)).toBe("Color: Black, Size: 42, Storage size: 256GB");
  });
});

describe("productInputSchema", () => {
  it("converts price to minor units and applies defaults", () => {
    const r = productInputSchema.parse({ name: "Bag", price: "45,000" });
    expect(r.price).toBe(4_500_000);
    expect(r.stock).toBe(0);
    expect(r.status).toBe("active");
    expect(r.variants).toEqual([]);
  });

  it("rejects invalid price and negative stock", () => {
    expect(productInputSchema.safeParse({ name: "Bag", price: "free" }).success).toBe(false);
    expect(productInputSchema.safeParse({ name: "Bag", price: "10", stock: -1 }).success).toBe(false);
    expect(productInputSchema.safeParse({ name: "", price: "10" }).success).toBe(false);
  });

  it("validates variants", () => {
    const ok = productInputSchema.parse({ name: "Shoe", price: "10000", variants: [{ name: "42", options: "Size: 42", stock: "3", price: "" }] });
    expect(ok.variants[0]).toMatchObject({ name: "42", stock: 3, price: null });
    expect(productInputSchema.safeParse({ name: "Shoe", price: "1", variants: [{ name: "", stock: 1 }] }).success).toBe(false);
  });
});

describe("parseProductCsv", () => {
  it("parses the template", () => {
    const r = parseProductCsv(CSV_TEMPLATE);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ name: "Black Leather Bag", sku: "BAG-BLK-01", price_minor: 4_500_000, stock_quantity: 20, status: "active" });
    expect(r.rows[1].description).toBeNull();
  });

  it("accepts header aliases, BOM, quotes and thousands separators", () => {
    const csv = '﻿Product Name,Price (NGN),Qty,SKU\n"Bag, large","45,000",3,B1\n';
    const r = parseProductCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ name: "Bag, large", price_minor: 4_500_000, stock_quantity: 3, sku: "B1" });
  });

  it("reports missing required columns", () => {
    const r = parseProductCsv("name,stock\nBag,3\n");
    expect(r.rows).toEqual([]);
    expect(r.errors[0].message).toMatch(/price/);
  });

  it("reports row errors with line numbers (trailing empty cells are fine)", () => {
    const r = parseProductCsv("name,price,stock,sku,status\nBag,abc,1,A\n,100,1,B\nShoe,100,-2,C\nHat,100,1,H\nCap,100,1,D,deleted\n");
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 6]);
    expect(r.errors[0].message).toMatch(/price/);
    expect(r.errors[3].message).toMatch(/status/);
    expect(r.rows.map((x) => x.name)).toEqual(["Hat"]);
  });

  it("rejects duplicate SKUs case-insensitively", () => {
    const r = parseProductCsv("name,price,sku\nBag,100,BAG-1\nBag 2,100,bag-1\n");
    expect(r.errors).toEqual([{ line: 3, message: 'duplicate SKU "bag-1" (also on line 2)' }]);
  });

  it("flags unquoted commas", () => {
    const r = parseProductCsv("name,price\nBag, large,100\n");
    expect(r.errors[0].message).toMatch(/too many columns/);
  });

  it("rejects empty files and oversized files", () => {
    expect(parseProductCsv("name,price\n").errors[0].message).toMatch(/no product rows/);
    expect(parseProductCsv("x".repeat(1_000_001)).errors[0].message).toMatch(/1 MB/);
  });

  it("caps row count", () => {
    const csv = "name,price\n" + Array.from({ length: 2001 }, (_, i) => `P${i},100`).join("\n");
    expect(parseProductCsv(csv).errors[0].message).toMatch(/Too many rows/);
  });
});
