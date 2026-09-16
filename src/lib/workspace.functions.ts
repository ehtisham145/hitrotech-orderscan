import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { assertWorkspaceRole } from "./authz.server";
import type { ServerContext } from "./server-context";

// Each handler is a plain `<name>Core(data, context)` function with a one-line
// createServerFn wrapper under it — see src/lib/server-context.ts for why.

/**
 * Returns the active workspace for the signed-in user.
 * - Preference: profile.active_workspace_id when it's a workspace the user still belongs to.
 * - Fallback: their oldest membership.
 * - Also returns the caller's role in that workspace, and whether they are super admin.
 */
type WorkspaceProvisioningContext = ServerContext & {
  claims?: { email?: string; user_metadata?: { full_name?: string; name?: string } };
};

export async function getActiveWorkspaceCore(context: WorkspaceProvisioningContext) {
  const { supabase, userId } = context;

  const [profileRes, memberRes, superRes] = await Promise.all([
    supabase.from("profiles").select("active_workspace_id").eq("id", userId).maybeSingle(),
    supabase
      .from("workspace_members")
      .select("workspace_id, role, workspaces(id, name, slug, owner_id, plan_tier, plan_expires_at, seat_limit)")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle(),
  ]);
  // BUG FIX: none of these three errors was checked. A transient failure on
  // any of them — especially memberRes — fell through to "the caller has no
  // memberships", which triggers the auto-provisioning path below and could
  // create a duplicate workspace for a user who already has one.
  if (profileRes.error) throw new Error(profileRes.error.message);
  if (memberRes.error) throw new Error(memberRes.error.message);
  if (superRes.error) throw new Error(superRes.error.message);

  const isSuperAdmin = !!superRes.data;

  let memberships = (memberRes.data ?? []) as Array<{
    workspace_id: string;
    role: string;
    workspaces: {
      id: string; name: string; slug: string; owner_id: string;
      plan_tier: string; plan_expires_at: string | null; seat_limit: number;
    } | null;
  }>;

  const preferred = profileRes.data?.active_workspace_id;

  // A migrated backend may be missing the auth trigger that provisions a
  // workspace for brand-new accounts. Repair that state on first load after
  // the caller has been authenticated, so no user — including a super admin
  // signing in before any customer workspaces exist — is stranded at “None”.
  if (memberships.length === 0) {
    const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");
    const claims = context.claims as { email?: string; user_metadata?: { full_name?: string; name?: string } };
    const email = claims.email ?? "";
    const displayName = claims.user_metadata?.full_name ?? claims.user_metadata?.name ?? email.split("@")[0] ?? "My";
    const workspaceName = `${displayName}'s Workspace`.slice(0, 80);
    const slugBase = (email.split("@")[0] || "workspace")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "workspace";

    // BUG FIX: this upsert's error was discarded entirely. If it failed, the
    // code proceeded to create/link a workspace against a profiles row that
    // might not exist — the later active_workspace_id update would then
    // silently match zero rows.
    const { error: profileUpsertErr } = await supabaseAdmin.from("profiles").upsert({
      id: userId,
      email,
      full_name: displayName,
    }, { onConflict: "id" });
    if (profileUpsertErr) throw new Error(`Could not set up your profile: ${profileUpsertErr.message}`);

    let { data: ownedWorkspace } = await supabaseAdmin
      .from("workspaces")
      .select("id, name, slug, owner_id, plan_tier, plan_expires_at, seat_limit")
      .eq("owner_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!ownedWorkspace) {
      const created = await supabaseAdmin
        .from("workspaces")
        .insert({
          name: workspaceName,
          slug: `${slugBase}-${userId.replace(/-/g, "").slice(0, 6)}`,
          owner_id: userId,
        })
        .select("id, name, slug, owner_id, plan_tier, plan_expires_at, seat_limit")
        .single();
      if (created.error) throw new Error(`Could not create your workspace: ${created.error.message}`);
      ownedWorkspace = created.data;
    }

    const { error: memberError } = await supabaseAdmin.from("workspace_members").insert({
      workspace_id: ownedWorkspace.id,
      user_id: userId,
      role: "owner",
    });
    if (memberError) throw new Error(`Could not activate your workspace: ${memberError.message}`);

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ active_workspace_id: ownedWorkspace.id })
      .eq("id", userId);
    if (profileError) throw new Error(`Could not select your workspace: ${profileError.message}`);

    memberships = [{ workspace_id: ownedWorkspace.id, role: "owner", workspaces: ownedWorkspace }];
  }

  let active = memberships.find((m) => m.workspace_id === preferred) ?? null;

  // Super admin can view any workspace even without membership — load it directly.
  let impersonated: {
    workspace_id: string;
    role: string;
    workspaces: {
      id: string; name: string; slug: string; owner_id: string;
      plan_tier: string; plan_expires_at: string | null; seat_limit: number;
    } | null;
  } | null = null;
  if (!active && preferred && isSuperAdmin) {
    const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");

    // BUG FIX: this lookup's error was discarded. Logged rather than thrown
    // — a failed impersonation lookup shouldn't deny the super admin their
    // own normal workspace access, which the fallback below still provides.
    const { data: ws, error: impersonateErr } = await supabaseAdmin
      .from("workspaces")
      .select("id, name, slug, owner_id, plan_tier, plan_expires_at, seat_limit")
      .eq("id", preferred)
      .maybeSingle();
    if (impersonateErr) {
      console.error("[workspace] Could not load workspace for super-admin impersonation:", impersonateErr.message);
    }
    if (ws) {
      impersonated = { workspace_id: ws.id, role: "admin", workspaces: ws as any };
      active = impersonated;
    }
  }

  if (!active) active = memberships[0] ?? null;

  // Only reset when the preferred workspace is truly inaccessible (not a member AND not super admin resolvable).
  if (preferred && !memberships.some((m) => m.workspace_id === preferred) && !impersonated && active) {
    // BUG FIX: this write's result was discarded. Logged rather than thrown —
    // the response already computed below is correct either way; this write
    // only persists the correction for the caller's *next* load.
    const { error: fixErr } = await supabase.from("profiles").update({ active_workspace_id: active.workspace_id }).eq("id", userId);
    if (fixErr) console.error("[workspace] Could not persist corrected active_workspace_id:", fixErr.message);
  }

  const toWs = (m: { workspace_id: string; role: string; workspaces: any }) => ({
    id: m.workspaces!.id,
    name: m.workspaces!.name,
    slug: m.workspaces!.slug,
    owner_id: m.workspaces!.owner_id,
    role: m.role,
    plan_tier: (m.workspaces!.plan_tier ?? "free") as "free" | "starter" | "pro" | "enterprise",
    plan_expires_at: m.workspaces!.plan_expires_at,
    seat_limit: Number(m.workspaces!.seat_limit ?? 0),
  });

  const list = memberships.filter((m) => m.workspaces).map(toWs);
  if (impersonated && !list.some((w) => w.id === impersonated!.workspaces!.id)) {
    list.push(toWs(impersonated));
  }

  const isImpersonating =
    isSuperAdmin &&
    !!active &&
    !memberships.some((m) => m.workspace_id === active!.workspace_id);

  return {
    workspace: active?.workspaces ? toWs(active) : null,
    workspaces: list,
    isSuperAdmin,
    isImpersonating,
  };
}

export const getActiveWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => getActiveWorkspaceCore(context));

/** Set the active workspace on the caller's profile. */
export async function setActiveWorkspaceCore(data: { workspaceId: string }, context: ServerContext) {
  const { supabase, userId } = context;

  // Ensure the caller is a member or a super admin (RLS on workspace_members enforces this via SELECT)
  const [membershipRes, superRes] = await Promise.all([
    supabase.from("workspace_members").select("workspace_id").eq("user_id", userId).eq("workspace_id", data.workspaceId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle(),
  ]);
  // BUG FIX: neither error was checked. Both failure modes already fail
  // *safe* here (falling through to "Not a member"), but a transient DB
  // error deserves to be reported as one rather than misreported as a
  // membership refusal.
  if (membershipRes.error) throw new Error(membershipRes.error.message);
  if (superRes.error) throw new Error(superRes.error.message);

  if (!membershipRes.data && !superRes.data) throw new Error("Not a member of this workspace");

  const { error } = await supabase.from("profiles").update({ active_workspace_id: data.workspaceId }).eq("id", userId);
  if (error) throw error;
  return { ok: true };
}

export const setActiveWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(({ data, context }) => setActiveWorkspaceCore(data, context));

/** Create a new workspace (any signed-in user). Adds caller as owner. */
export async function createWorkspaceCore(data: { name: string }, context: ServerContext) {
  const { supabase, userId } = context;
  const name = data.name.trim().slice(0, 80);
  if (!name) throw new Error("Workspace name required");

  const slugBase = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "workspace";
  const slug = `${slugBase}-${userId.replace(/-/g, "").slice(0, 6)}`;

  const { data: ws, error: wsErr } = await supabase
    .from("workspaces")
    .insert({ name, slug, owner_id: userId })
    .select("id")
    .single();
  if (wsErr) throw wsErr;

  const { error: memErr } = await supabase
    .from("workspace_members")
    .insert({ workspace_id: ws.id, user_id: userId, role: "owner" });
  if (memErr) throw memErr;

  // BUG FIX: this write's error was fully discarded — the new workspace and
  // membership already exist by this point, so logging (not throwing) keeps
  // the caller from seeing a false failure for a workspace that really was
  // created; it just might not have become "active" yet.
  const { error: activateErr } = await supabase.from("profiles").update({ active_workspace_id: ws.id }).eq("id", userId);
  if (activateErr) console.error("[workspace] Could not activate the new workspace:", activateErr.message);

  const { error: auditErr } = await supabase.from("audit_logs").insert({
    user_id: userId,
    workspace_id: ws.id,
    action: "workspace.create",
    entity_type: "workspace",
    entity_id: ws.id,
    details: { name, slug },
  });
  if (auditErr) console.error("[workspace] Could not write audit log for workspace.create:", auditErr.message);

  return { id: ws.id };
}

export const createWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string }) => input)
  .handler(({ data, context }) => createWorkspaceCore(data, context));

/** Rename the active workspace. Owner or admin only. */
// BUG FIX: this handler had no authorization check at all — only
// requireSupabaseAuth (any signed-in user), despite the doc comment saying
// "Owner or admin only". Any authenticated user could rename any workspace
// by id. assertWorkspaceRole added to actually enforce that.
export async function renameWorkspaceCore(data: { workspaceId: string; name: string }, context: ServerContext) {
  const { supabase, userId } = context;
  await assertWorkspaceRole(supabase, userId, data.workspaceId, ["owner", "admin"]);
  const name = data.name.trim().slice(0, 80);
  if (!name) throw new Error("Workspace name required");
  const { data: prev, error: prevErr } = await supabase.from("workspaces").select("name").eq("id", data.workspaceId).maybeSingle();
  if (prevErr) throw new Error(prevErr.message);
  const { error } = await supabase.from("workspaces").update({ name }).eq("id", data.workspaceId);
  if (error) throw error;
  const { error: auditErr } = await supabase.from("audit_logs").insert({
    user_id: userId,
    workspace_id: data.workspaceId,
    action: "workspace.rename",
    entity_type: "workspace",
    entity_id: data.workspaceId,
    details: { from: prev?.name ?? null, to: name },
  });
  if (auditErr) console.error("[workspace] Could not write audit log for workspace.rename:", auditErr.message);
  return { ok: true };
}

export const renameWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; name: string }) => input)
  .handler(({ data, context }) => renameWorkspaceCore(data, context));

/** Delete the workspace. Owner only. Cascades via FK. */
export async function deleteWorkspaceCore(data: { workspaceId: string; confirmName: string }, context: ServerContext) {
  const { supabase, userId } = context;
  const { data: ws, error: wsErr } = await supabase
    .from("workspaces")
    .select("id, name, owner_id")
    .eq("id", data.workspaceId)
    .maybeSingle();
  if (wsErr) throw wsErr;
  if (!ws) throw new Error("Workspace not found");
  if (ws.owner_id !== userId) throw new Error("Only the owner can delete this workspace");
  if (ws.name.trim() !== data.confirmName.trim()) throw new Error("Name confirmation does not match");

  // Log BEFORE delete so we retain workspace context; audit_logs has no FK to
  // workspaces. Thrown (not just logged) because nothing destructive has
  // happened yet — better to abort the delete than delete without a trail.
  const { error: auditErr } = await supabase.from("audit_logs").insert({
    user_id: userId,
    workspace_id: data.workspaceId,
    action: "workspace.delete",
    entity_type: "workspace",
    entity_id: data.workspaceId,
    details: { name: ws.name },
  });
  if (auditErr) throw new Error(auditErr.message);

  // BUG FIX / ordering: profiles.active_workspace_id has a foreign key to
  // workspaces (see CLAUDE.md §2.10 — the same FK that made a CASCADE wipe
  // a profile during a past manual data wipe). The caller's own profile is
  // very likely still pointing at the workspace being deleted right now.
  // The old code deleted the workspace *first* and only moved the caller to
  // another workspace afterward — if that FK really does cascade, deleting
  // the workspace here could take the caller's own profile row down with
  // it before this code ever got to reassign it. Reordered so the profile
  // is moved off this workspace *before* the delete runs, regardless of
  // what the FK actually does.
  const { data: other, error: otherErr } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .neq("workspace_id", data.workspaceId)
    .limit(1)
    .maybeSingle();
  if (otherErr) throw otherErr;
  const nextWorkspaceId = other?.workspace_id ?? null;

  const { error: reassignErr } = await supabase.from("profiles").update({ active_workspace_id: nextWorkspaceId }).eq("id", userId);
  if (reassignErr) throw reassignErr;

  const { error } = await supabase.from("workspaces").delete().eq("id", data.workspaceId);
  if (error) throw error;

  return { ok: true, nextWorkspaceId };
}

export const deleteWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; confirmName: string }) => input)
  .handler(({ data, context }) => deleteWorkspaceCore(data, context));

/** Leave a workspace. Non-owners only. Switches active workspace if needed. */
export async function leaveWorkspaceCore(data: { workspaceId: string }, context: ServerContext) {
  const { supabase, userId } = context;

  const { data: ws, error: wsErr } = await supabase
    .from("workspaces")
    .select("id, name, owner_id")
    .eq("id", data.workspaceId)
    .maybeSingle();
  if (wsErr) throw wsErr;
  if (!ws) throw new Error("Workspace not found");
  if (ws.owner_id === userId) {
    throw new Error("Owners cannot leave their own workspace. Transfer ownership or delete the workspace first.");
  }

  const { data: membership, error: membershipErr } = await supabase
    .from("workspace_members")
    .select("id, role")
    .eq("workspace_id", data.workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipErr) throw membershipErr;
  if (!membership) throw new Error("You are not a member of this workspace");

  const { error: delErr } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", data.workspaceId)
    .eq("user_id", userId);
  if (delErr) throw delErr;

  const { error: auditErr } = await supabase.from("audit_logs").insert({
    user_id: userId,
    workspace_id: data.workspaceId,
    action: "workspace.member_left",
    entity_type: "workspace_member",
    entity_id: membership.id,
    details: { workspace_name: ws.name, role: membership.role },
  });
  if (auditErr) console.error("[workspace] Could not write audit log for workspace.member_left:", auditErr.message);

  // If the workspace they left was the active one, pick another (or null)
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("active_workspace_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileErr) throw profileErr;

  let nextWorkspaceId: string | null = profile?.active_workspace_id ?? null;
  if (nextWorkspaceId === data.workspaceId) {
    const { data: other, error: otherErr } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (otherErr) throw otherErr;
    nextWorkspaceId = other?.workspace_id ?? null;
    const { error: reassignErr } = await supabase.from("profiles").update({ active_workspace_id: nextWorkspaceId }).eq("id", userId);
    if (reassignErr) console.error("[workspace] Could not reassign active_workspace_id after leaving:", reassignErr.message);
  }

  return { ok: true, nextWorkspaceId };
}

export const leaveWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(({ data, context }) => leaveWorkspaceCore(data, context));
