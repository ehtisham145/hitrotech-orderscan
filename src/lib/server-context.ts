import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * What a `createServerFn` handler actually needs from its context.
 *
 * Handlers are written as a plain `<name>Core(data, context)` function and the
 * `createServerFn` export is a one-line wrapper around it. That split exists so
 * the logic is callable from Vitest: the `requireSupabaseAuth` middleware every
 * server function here uses calls `getRequest()`, which only resolves inside a
 * real request, so a handler defined inline is unreachable from a test.
 *
 * Declaring the shape here rather than per-file keeps the 26 function modules
 * agreeing on one definition — it had already been copy-pasted into two before
 * this existed.
 */
export type ServerContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
};
