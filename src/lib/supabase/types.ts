import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/types/database";

/** A Supabase client of either kind (user/RLS or service role). */
export type DbClient = SupabaseClient<Database>;
