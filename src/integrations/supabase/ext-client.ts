// Browser Supabase client pointed at the self-owned Supabase project.
// Replaces the Lovable Cloud generated client across the app.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { EXT_SUPABASE_URL, EXT_SUPABASE_PUBLISHABLE_KEY, createSupabaseFetch } from "./ext-config";

function createExtSupabaseClient() {
  return createClient<Database>(EXT_SUPABASE_URL, EXT_SUPABASE_PUBLISHABLE_KEY, {
    global: { fetch: createSupabaseFetch(EXT_SUPABASE_PUBLISHABLE_KEY) },
    auth: {
      storage: typeof window !== "undefined" ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let _supabase: ReturnType<typeof createExtSupabaseClient> | undefined;

export const supabase = new Proxy({} as ReturnType<typeof createExtSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createExtSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
