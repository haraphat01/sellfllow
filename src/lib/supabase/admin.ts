import "server-only";

import { createClient } from "@supabase/supabase-js";

import { publicEnv } from "@/lib/env/public";
import { serverEnv } from "@/lib/env/server";
import type { Database } from "@/db/types/database";

/**
 * Service-role client: BYPASSES RLS.
 *
 * Only for trusted server contexts that have already established tenant
 * context from trusted data: webhooks (phone_number_id / verified payment
 * reference), background jobs, platform admin. Every query made with this
 * client MUST filter by an explicit business_id.
 */
let adminClient: ReturnType<typeof createClient<Database>> | undefined;

export function createAdminClient() {
  if (!adminClient) {
    adminClient = createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return adminClient;
}
