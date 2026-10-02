"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

/**
 * Subscribes to this business's conversations/messages via Supabase Realtime
 * (RLS applies — users only receive rows they can read) and re-renders the
 * server components when anything changes. Debounced so bursts cause one refresh.
 */
export function RealtimeRefresh({ businessId }: { businessId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 300);
    };
    const filter = `business_id=eq.${businessId}`;
    const channel = supabase
      .channel(`inbox:${businessId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter }, refresh)
      .subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [businessId, router]);

  return null;
}
