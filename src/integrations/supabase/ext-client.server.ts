// Service-role Supabase client for the self-owned Supabase project.
// Server-only: never import from client-reachable module scope.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { createSupabaseFetch } from "./ext-config";

function createExtAdminClient() {
  const url = process.env.EXT_SUPABASE_URL;
  const key = process.env.EXT_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    const missing = [
      ...(!url ? ["EXT_SUPABASE_URL"] : []),
      ...(!key ? ["EXT_SUPABASE_SERVICE_ROLE_KEY"] : []),
    ];
    throw new Error(`Missing Supabase environment variable(s): ${missing.join(", ")}.`);
  }

  return createClient<Database>(url, key, {
    global: { fetch: createSupabaseFetch(key) },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

let _admin: ReturnType<typeof createExtAdminClient> | undefined;

export const supabaseAdmin = new Proxy({} as ReturnType<typeof createExtAdminClient>, {
  get(_, prop, receiver) {
    if (!_admin) _admin = createExtAdminClient();
    return Reflect.get(_admin, prop, receiver);
  },
});
