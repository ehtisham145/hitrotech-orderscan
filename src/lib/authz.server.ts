// Server-side authorization helpers used inside createServerFn handlers.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireActiveWorkspaceId } from "./workspace-helpers";

/**
 * Ensure the caller has one of the given workspace roles in the active workspace.
 * Uses the `has_workspace_role` SQL function (SECURITY DEFINER), which also
 * returns true for super_admin. Throws a Forbidden error otherwise.
 */
export async function assertActiveWorkspaceRole(
  supabase: SupabaseClient<Database>,
  userId: string,
  roles: Array<"owner" | "admin" | "manager" | "member" | "viewer">,
): Promise<string> {
  const wsId = await requireActiveWorkspaceId(supabase, userId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("has_workspace_role", {
    _ws: wsId,
    _roles: roles,
    _user_id: userId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: insufficient workspace role");
  return wsId;
}

/**
 * Same check but for an arbitrary workspace id (not necessarily the active one).
 */
export async function assertWorkspaceRole(
  supabase: SupabaseClient<Database>,
  userId: string,
  workspaceId: string,
  roles: Array<"owner" | "admin" | "manager" | "member" | "viewer">,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("has_workspace_role", {
    _ws: workspaceId,
    _roles: roles,
    _user_id: userId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: insufficient workspace role");
}
