"use client";

import { useRef, useState, useTransition } from "react";
import { Info, Loader2, SendHorizonal } from "lucide-react";
import { toast } from "sonner";

import { sendReplyAction } from "@/app/(app)/conversations/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function Composer({
  conversationId,
  aiActive,
  windowOpen,
  closed,
  canReply,
}: {
  conversationId: string;
  aiActive: boolean;
  windowOpen: boolean;
  closed: boolean;
  canReply: boolean;
}) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);

  if (!canReply) return <div className="border-t px-4 py-3 text-sm text-muted-foreground">You can read this conversation but not reply.</div>;
  if (closed) return <div className="border-t px-4 py-3 text-sm text-muted-foreground">This conversation is resolved. Reopen it to reply.</div>;
  if (!windowOpen) {
    return (
      <div className="flex gap-2 border-t bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        More than 24 hours have passed since the customer’s last message. WhatsApp only allows approved template messages until they write again.
      </div>
    );
  }

  const send = () => {
    const body = text.trim();
    if (!body || pending) return;
    start(async () => {
      const res = await sendReplyAction(conversationId, body);
      if (res.ok) {
        setText("");
        ref.current?.focus();
      } else toast.error(res.error);
    });
  };

  return (
    <div className="border-t bg-card px-4 py-3">
      {aiActive && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="size-3.5" /> Sending a reply takes over from the AI for this conversation.
        </p>
      )}
      <form
        // POST, never GET, if submitted before hydration (keeps text out of URLs)
        method="post"
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <Textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          maxLength={4096}
          placeholder="Reply on WhatsApp…  (Enter to send, Shift+Enter for a new line)"
          className="max-h-40 min-h-10 resize-none"
          aria-label="Reply"
        />
        <Button type="submit" size="icon" disabled={pending || !text.trim()} aria-label="Send">
          {pending ? <Loader2 className="animate-spin" /> : <SendHorizonal />}
        </Button>
      </form>
    </div>
  );
}
