"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { addNoteAction } from "@/app/(app)/conversations/actions";
import { addTagAction, removeTagAction } from "@/app/(app)/customers/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function NoteForm({ conversationId }: { conversationId: string }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      method="post"
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        start(async () => {
          const res = await addNoteAction(conversationId, text);
          if (res.ok) setText("");
          else toast.error(res.error);
        });
      }}
    >
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder="Add a private note for your team" aria-label="Note" />
      <Button type="submit" variant="outline" size="sm" disabled={pending || !text.trim()} className="justify-self-end">
        {pending && <Loader2 className="animate-spin" />} Add note
      </Button>
    </form>
  );
}

export function TagEditor({ customerId, tags, canEdit }: { customerId: string; tags: string[]; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.length === 0 && !adding && <span className="text-sm text-muted-foreground">No tags</span>}
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
          {t}
          {canEdit && (
            <button
              type="button"
              aria-label={`Remove tag ${t}`}
              className="rounded-full hover:text-destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await removeTagAction(customerId, t);
                  if (!res.ok) toast.error(res.error);
                })
              }
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      {canEdit &&
        (adding ? (
          <form
            method="post"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await addTagAction(customerId, value);
                if (res.ok) {
                  setValue("");
                  setAdding(false);
                } else toast.error(res.error);
              });
            }}
          >
            <Input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => !value && setAdding(false)}
              maxLength={40}
              placeholder="e.g. vip"
              className="h-7 w-28 text-xs"
              aria-label="New tag"
            />
          </form>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-0.5 rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted">
            <Plus className="size-3" /> Tag
          </button>
        ))}
    </div>
  );
}
