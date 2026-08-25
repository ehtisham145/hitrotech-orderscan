import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Returns the caller's active workspace id, or throws.
 * Server-side helper used inside createServerFn handlers.
 */
export async function requireActiveWorkspaceId(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase.from("profiles").select("active_workspace_id").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  const ws = data?.active_workspace_id;
  if (!ws) throw new Error("No active workspace. Create one first.");
  return ws;
}

/** Look up workspace_id from a partner id (server-side). */
export async function workspaceIdForPartner(
  supabase: SupabaseClient<Database>,
  partnerId: string,
): Promise<string> {
  const { data, error } = await supabase.from("partners").select("workspace_id").eq("id", partnerId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.workspace_id) throw new Error("Partner not found");
  return data.workspace_id;
}
