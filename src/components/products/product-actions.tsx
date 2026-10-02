"use client";

import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteProductAction, setProductStatusAction } from "@/app/(app)/products/actions";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";

export function ProductActions({ productId, name, status }: { productId: string; name: string; status: string }) {
  const notify = (res: { ok: boolean; error?: string; message?: string }) => {
    if (res.ok) toast.success(res.message ?? "Done");
    else toast.error(res.error);
  };

  return (
    <div className="flex items-center gap-2">
      {status === "archived" ? (
        <Button variant="outline" size="sm" onClick={async () => notify(await setProductStatusAction(productId, "active"))}>
          <ArchiveRestore /> Restore
        </Button>
      ) : (
        <ConfirmButton
          variant="outline"
          size="sm"
          title={`Archive ${name}?`}
          description="Archived products are hidden from your AI agent and don’t count toward your plan’s product limit. You can restore it any time."
          confirmLabel="Archive"
          onConfirm={async () => notify(await setProductStatusAction(productId, "archived"))}
        >
          <Archive /> Archive
        </ConfirmButton>
      )}
      <ConfirmButton
        variant="ghost"
        size="sm"
        destructive
        title={`Delete ${name} permanently?`}
        description="This removes the product, its variants, images and stock history. Past orders keep their line items. Archiving is usually the better choice."
        confirmLabel="Delete permanently"
        onConfirm={async () => {
          const res = await deleteProductAction(productId);
          if (res && !res.ok) toast.error(res.error);
        }}
      >
        <Trash2 className="text-destructive" /> Delete
      </ConfirmButton>
    </div>
  );
}
