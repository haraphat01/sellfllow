"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

const FALLBACK_POLL_MS = 10_000;

/**
 * Subscribes to this business's conversations/messages via Supabase Realtime
 * (RLS applies — users only receive rows they can read) and re-renders the
 * server components when anything changes. Debounced so bursts cause one refresh.
 *
 * The signed-in user's access token is attached to the Realtime connection
 * *before* subscribing; otherwise Realtime treats the browser as anonymous and
 * RLS hides every change. If the connection fails, the page polls instead.
 */
export function RealtimeRefresh({ businessId }: { businessId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 300);
    };
    const startPolling = () => {
      if (!poll) poll = setInterval(() => document.visibilityState === "visible" && router.refresh(), FALLBACK_POLL_MS);
    };
    const stopPolling = () => {
      if (poll) clearInterval(poll);
      poll = null;
    };

    const { data: auth } = supabase.auth.onAuthStateChange((_event, session) => {
      void supabase.realtime.setAuth(session?.access_token ?? null);
    });

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      const filter = `business_id=eq.${businessId}`;
      channel = supabase
        .channel(`inbox:${businessId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter }, refresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter }, refresh)
        .subscribe((status, err) => {
          console.info(`[SellFlow] live updates: ${status}${err ? ` (${err.message})` : ""}`);
          if (status === "SUBSCRIBED") stopPolling();
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") startPolling();
        });
    })();

    // Catch up after the tab was in the background.
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      stopPolling();
      auth.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [businessId, router]);

  return null;
}
