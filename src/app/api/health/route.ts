import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

/** Liveness + database reachability. Returns no tenant data. */
export async function GET() {
  const started = Date.now();
  const { error } = await createAdminClient().from("subscription_plans").select("id", { head: true, count: "exact" });
  return NextResponse.json(
    { status: error ? "degraded" : "ok", db: error ? "unreachable" : "ok", latency_ms: Date.now() - started },
    { status: error ? 503 : 200, headers: { "cache-control": "no-store" } },
  );
}
