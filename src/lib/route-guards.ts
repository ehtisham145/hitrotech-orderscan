import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/ext-client";

/**
 * Guard for admin/manager pages. Checks the user's role in their active
 * workspace (workspace_members.role). Super admins bypass. On failure,
 * redirects to /dashboard (or /auth if signed out).
 */
export async function requireWorkspaceRole(allowed: readonly string[]): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw redirect({ to: "/auth" });

  // Super admin bypass (global role in user_roles)
  const { data: globalRoles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", auth.user.id);
  if ((globalRoles ?? []).some((r) => r.role === "super_admin")) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("active_workspace_id")
    .eq("id", auth.user.id)
    .maybeSingle();
  const wsId = profile?.active_workspace_id;
  if (!wsId) throw redirect({ to: "/dashboard" });

  const { data: member } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("user_id", auth.user.id)
    .eq("workspace_id", wsId)
    .maybeSingle();

  if (!member || !allowed.includes(member.role)) {
    throw redirect({ to: "/dashboard" });
  }
}
