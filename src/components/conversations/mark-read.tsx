"use client";

import { useEffect } from "react";

import { markReadAction } from "@/app/(app)/conversations/actions";

export function MarkRead({ conversationId, unread }: { conversationId: string; unread: number }) {
  useEffect(() => {
    if (unread > 0) void markReadAction(conversationId);
  }, [conversationId, unread]);
  return null;
}
