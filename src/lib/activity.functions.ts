import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import type { ServerContext } from "./server-context";

// Each handler is a plain `<name>Core(data, context)` function with a one-line
// createServerFn wrapper under it — see src/lib/server-context.ts for why.

const HUMAN_ACTIONS: Record<string, string> = {
  "workspace.create": "created the workspace",
  "workspace.rename": "renamed the workspace",
  "workspace.delete": "deleted the workspace",
  "workspace.invite_sent": "invited",
  "workspace.invite_resent": "resent an invite to",
  "workspace.invite_revoked": "revoked an invite for",
  "workspace.invite_accepted": "joined the workspace",
  "workspace.member_role_updated": "updated a member's role",
  "workspace.member_removed": "removed a member",
  "workspace.member_left": "left the workspace",
  "workspace.ownership_transferred": "transferred ownership",
  "workspace.plan_updated": "updated the plan",
  "month.locked": "locked a month",
  "month.unlocked": "unlocked a month",
  "extraction.edit": "edited an activation",
};

export type ActivityEvent = {
  id: string;
  action: string;
  label: string;
  actor_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  details: any;
  created_at: string;
};

/** Recent workspace activity — audit log summarised for the dashboard feed. */
// BUG FIX: all three queries here discarded their error. The profile lookup
// and the audit_logs list both fell back to an empty feed on a genuine query
// failure — a real error and "nothing has happened yet" looked identical.
export async function getRecentActivityCore(data: { limit?: number }, context: ServerContext): Promise<ActivityEvent[]> {
  const { supabase, userId } = context;
  const { data: prof, error: profErr } = await supabase.from("profiles").select("active_workspace_id").eq("id", userId).maybeSingle();
  if (profErr) throw new Error(profErr.message);
  const wsId = prof?.active_workspace_id;
  if (!wsId) return [];

  const limit = Math.min(Math.max(data.limit ?? 10, 1), 50);
  const { data: rows, error } = await supabase
    .from("audit_logs")
    .select("id, user_id, action, entity_type, entity_id, details, created_at")
    .eq("workspace_id", wsId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const list = rows ?? [];
  const userIds = Array.from(new Set(list.map((r: any) => r.user_id).filter(Boolean)));
  const profMap = new Map<string, string>();
  if (userIds.length) {
    const { data: profs, error: profsErr } = await supabase.from("profiles").select("id, full_name, email").in("id", userIds);
    if (profsErr) throw new Error(profsErr.message);
    for (const p of profs ?? []) profMap.set((p as any).id, (p as any).full_name || (p as any).email || "A teammate");
  }

  return list.map((r: any) => ({
    id: r.id,
    action: r.action,
    label: HUMAN_ACTIONS[r.action] ?? r.action.replace(/[._]/g, " "),
    actor_name: r.user_id ? profMap.get(r.user_id) ?? null : null,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    details: r.details ?? {},
    created_at: r.created_at,
  }));
}

export const getRecentActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number }) => input)
  .handler(({ data, context }) => getRecentActivityCore(data, context));
