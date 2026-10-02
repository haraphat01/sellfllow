"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { ImagePlus, Loader2, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { addProductImageAction, makePrimaryImageAction, removeProductImageAction } from "@/app/(app)/products/actions";
import { Button } from "@/components/ui/button";
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES, PRODUCT_IMAGES_BUCKET, productImageUrl } from "@/lib/products/images";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Img = { id: string; storage_path: string; alt: string | null };

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_IMAGES = 8;

export function ProductImages({ businessId, productId, images, productName }: { businessId: string; productId: string; images: Img[]; productName: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [pending, startTransition] = useTransition();

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, Math.max(0, MAX_IMAGES - images.length));
    if (list.length < files.length) toast.warning(`Only ${MAX_IMAGES} images per product.`);

    const supabase = createClient();
    setUploading(list.length);
    for (const file of list) {
      try {
        if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) throw new Error(`${file.name}: use JPG, PNG or WebP`);
        if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name}: larger than 5 MB`);

        // Path prefix = business id; Storage RLS only allows members with products.manage.
        const path = `${businessId}/${productId}/${crypto.randomUUID()}.${EXT[file.type]}`;
        const { error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).upload(path, file, { contentType: file.type, cacheControl: "31536000" });
        if (error) throw new Error(`${file.name}: upload failed`);

        const res = await addProductImageAction(productId, path);
        if (!res.ok) throw new Error(res.error);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error);
      else if (res.message) toast.success(res.message);
    });

  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h2 className="font-semibold">Images</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">The first image is sent to customers who ask to see the product.</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={uploading > 0 || images.length >= MAX_IMAGES} onClick={() => inputRef.current?.click()}>
          {uploading > 0 ? <Loader2 className="animate-spin" /> : <ImagePlus />} Upload
        </Button>
        <input ref={inputRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(",")} multiple hidden onChange={(e) => upload(e.target.files)} />
      </div>

      <div
        className="p-6"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          upload(e.dataTransfer.files);
        }}
      >
        {images.length === 0 && uploading === 0 ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center rounded-lg border border-dashed px-6 py-10 text-sm text-muted-foreground hover:bg-muted/50"
          >
            <ImagePlus className="mb-2 size-6" />
            Drop images here or click to upload
            <span className="mt-1 text-xs">JPG, PNG or WebP · up to 5 MB each</span>
          </button>
        ) : (
          <ul className={cn("grid grid-cols-3 gap-3 sm:grid-cols-4", pending && "opacity-60")}>
            {images.map((img, i) => (
              <li key={img.id} className="group relative aspect-square overflow-hidden rounded-lg border bg-muted">
                <Image src={productImageUrl(img.storage_path)} alt={img.alt ?? productName} fill sizes="160px" className="object-cover" />
                {i === 0 && <span className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">Main</span>}
                <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/60 p-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  {i !== 0 && (
                    <button type="button" aria-label="Make main image" className="rounded bg-white/90 p-1 hover:bg-white" onClick={() => run(() => makePrimaryImageAction(productId, img.id))}>
                      <Star className="size-3.5" />
                    </button>
                  )}
                  <button type="button" aria-label="Remove image" className="rounded bg-white/90 p-1 text-destructive hover:bg-white" onClick={() => run(() => removeProductImageAction(productId, img.id))}>
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
            {Array.from({ length: uploading }).map((_, i) => (
              <li key={`u${i}`} className="flex aspect-square items-center justify-center rounded-lg border bg-muted">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
