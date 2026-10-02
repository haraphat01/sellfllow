import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { daysUntil } from "@/lib/time";

/** App-wide notice when the subscription needs attention (trial ending, payment due, ended). */
export async function SubscriptionBanner({ businessId, canManage }: { businessId: string; canManage: boolean }) {
  const db = await createClient();
  const { data: sub } = await db.from("subscriptions").select("status, trial_ends_at").eq("business_id", businessId).maybeSingle();
  if (!sub) return null;

  const trialDays = sub.status === "trialing" && sub.trial_ends_at ? daysUntil(sub.trial_ends_at) : null;
  let tone: "warn" | "error";
  let text: string;
  if (sub.status === "past_due") {
    tone = "warn";
    text = "We couldn't renew your subscription. Pay within 3 days to keep the AI assistant running.";
  } else if (sub.status === "expired" || sub.status === "cancelled") {
    tone = "error";
    text = "Your subscription has ended. The AI assistant and automations are paused.";
  } else if (trialDays !== null && trialDays <= 3) {
    tone = "warn";
    text = trialDays <= 0 ? "Your free trial ends today." : `Your free trial ends in ${trialDays} day${trialDays === 1 ? "" : "s"}.`;
  } else return null;

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-6 py-2.5 text-sm ${tone === "error" ? "bg-destructive/10 text-destructive" : "bg-warning/15"}`}>
      {tone === "error" ? <AlertTriangle className="size-4" /> : <Clock className="size-4" />}
      <span>{text}</span>
      {canManage ? (
        <Link href="/billing" className="font-medium underline-offset-2 hover:underline">
          {sub.status === "past_due" ? "Pay now" : "Choose a plan"} →
        </Link>
      ) : (
        <span className="text-muted-foreground">Ask an owner to update billing.</span>
      )}
    </div>
  );
}
