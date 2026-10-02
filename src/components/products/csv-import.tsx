"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { importProductsAction, previewImportAction, type ImportPreview } from "@/app/(app)/products/actions";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";

const MAX_BYTES = 1_000_000;

export function CsvImport({ currency }: { currency: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      toast.error("File is larger than 1 MB. Split it into smaller files.");
      return;
    }
    startTransition(async () => {
      const text = await f.text();
      setFile({ name: f.name, text });
      const res = await previewImportAction(text);
      if (!res.ok) {
        toast.error(res.error);
        setPreview(null);
      } else setPreview(res.preview);
    });
  }

  function runImport() {
    if (!file) return;
    startTransition(async () => {
      const res = await importProductsAction(file.text);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(res.message);
        router.push("/products");
      }
    });
  }

  const valid = preview && preview.errors.length === 0 && preview.validRows > 0;

  return (
    <div className="grid gap-6">
      <section className="rounded-xl border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h2 className="font-semibold">1. Prepare your spreadsheet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Required columns: <code className="rounded bg-muted px-1">name</code>, <code className="rounded bg-muted px-1">price</code>. Optional:{" "}
              <code className="rounded bg-muted px-1">sku</code>, <code className="rounded bg-muted px-1">stock</code>, <code className="rounded bg-muted px-1">category</code>,{" "}
              <code className="rounded bg-muted px-1">brand</code>, <code className="rounded bg-muted px-1">description</code>, <code className="rounded bg-muted px-1">status</code>. Prices are in{" "}
              {currency} (e.g. 45000). Rows with a SKU that already exists update that product.
            </p>
          </div>
          <Button variant="outline" asChild>
            <a href="/products/import/template" download>
              <Download /> Download template
            </a>
          </Button>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-6">
        <h2 className="mb-4 font-semibold">2. Upload the CSV</h2>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            choose(e.dataTransfer.files[0]);
          }}
          className="flex w-full flex-col items-center rounded-lg border border-dashed px-6 py-10 text-sm text-muted-foreground hover:bg-muted/50"
        >
          {pending && !preview ? <Loader2 className="mb-2 size-6 animate-spin" /> : <FileSpreadsheet className="mb-2 size-6" />}
          {file ? <span className="font-medium text-foreground">{file.name}</span> : "Drop a .csv file here or click to choose"}
          <span className="mt-1 text-xs">Up to 2,000 rows · 1 MB</span>
        </button>
        <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => choose(e.target.files?.[0])} />
      </section>

      {preview && (
        <section className="rounded-xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-4">
            <div className="flex items-center gap-2">
              {valid ? <CheckCircle2 className="size-5 text-success" /> : <AlertCircle className="size-5 text-destructive" />}
              <h2 className="font-semibold">
                {valid
                  ? `${preview.validRows.toLocaleString()} product${preview.validRows === 1 ? "" : "s"} ready to import`
                  : `${preview.errors.length} problem${preview.errors.length === 1 ? "" : "s"} found — nothing has been imported`}
              </h2>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" asChild>
                <Link href="/products">Cancel</Link>
              </Button>
              <Button disabled={!valid || pending} onClick={runImport}>
                {pending ? <Loader2 className="animate-spin" /> : <Upload />} Import {valid ? preview.validRows.toLocaleString() : ""} products
              </Button>
            </div>
          </div>

          {preview.errors.length > 0 && (
            <ul className="divide-y border-b text-sm">
              {preview.errors.map((e, i) => (
                <li key={i} className="flex gap-3 px-6 py-2">
                  <span className="w-16 shrink-0 text-muted-foreground">{e.line > 0 ? `Line ${e.line}` : "File"}</span>
                  <span className="text-destructive">{e.message}</span>
                </li>
              ))}
            </ul>
          )}

          {preview.sample.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-6 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">SKU</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 text-right font-medium">Price</th>
                    <th className="px-6 py-2 text-right font-medium">Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {preview.sample.map((r, i) => (
                    <tr key={i}>
                      <td className="px-6 py-2">{r.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.sku ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.category ?? "—"}</td>
                      <td className="tabular px-3 py-2 text-right">{formatMoney(r.price_minor, currency)}</td>
                      <td className="tabular px-6 py-2 text-right">{r.stock_quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.validRows > preview.sample.length && (
                <p className="px-6 py-3 text-xs text-muted-foreground">…and {preview.validRows - preview.sample.length} more</p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
