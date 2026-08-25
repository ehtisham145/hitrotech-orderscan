import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";

/**
 * Returns the active workspace for the signed-in user.
 * - Preference: profile.active_workspace_id when it's a workspace the user still belongs to.
 * - Fallback: their oldest membership.
 * - Also returns the caller's role in that workspace, and whether they are super admin.
 */
export const getActiveWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
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

      await supabaseAdmin.from("profiles").upsert({
        id: userId,
        email,
        full_name: displayName,
      }, { onConflict: "id" });

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

      const { data: ws } = await supabaseAdmin
        .from("workspaces")
        .select("id, name, slug, owner_id, plan_tier, plan_expires_at, seat_limit")
        .eq("id", preferred)
        .maybeSingle();
      if (ws) {
        impersonated = { workspace_id: ws.id, role: "admin", workspaces: ws as any };
        active = impersonated;
      }
    }

    if (!active) active = memberships[0] ?? null;

    // Only reset when the preferred workspace is truly inaccessible (not a member AND not super admin resolvable).
    if (preferred && !memberships.some((m) => m.workspace_id === preferred) && !impersonated && active) {
      await supabase.from("profiles").update({ active_workspace_id: active.workspace_id }).eq("id", userId);
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
  });

/** Set the active workspace on the caller's profile. */
export const setActiveWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Ensure the caller is a member or a super admin (RLS on workspace_members enforces this via SELECT)
    const [{ data: membership }, { data: superRow }] = await Promise.all([
      supabase.from("workspace_members").select("workspace_id").eq("user_id", userId).eq("workspace_id", data.workspaceId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle(),
    ]);

    if (!membership && !superRow) throw new Error("Not a member of this workspace");

    const { error } = await supabase.from("profiles").update({ active_workspace_id: data.workspaceId }).eq("id", userId);
    if (error) throw error;
    return { ok: true };
  });

/** Create a new workspace (any signed-in user). Adds caller as owner. */
export const createWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string }) => input)
  .handler(async ({ data, context }) => {
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

    await supabase.from("profiles").update({ active_workspace_id: ws.id }).eq("id", userId);

    await supabase.from("audit_logs").insert({
      user_id: userId,
      workspace_id: ws.id,
      action: "workspace.create",
      entity_type: "workspace",
      entity_id: ws.id,
      details: { name, slug },
    });

    return { id: ws.id };
  });

/** Rename the active workspace. Owner or admin only. */
export const renameWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; name: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const name = data.name.trim().slice(0, 80);
    if (!name) throw new Error("Workspace name required");
    const { data: prev } = await supabase.from("workspaces").select("name").eq("id", data.workspaceId).maybeSingle();
    const { error } = await supabase.from("workspaces").update({ name }).eq("id", data.workspaceId);
    if (error) throw error;
    await supabase.from("audit_logs").insert({
      user_id: userId,
      workspace_id: data.workspaceId,
      action: "workspace.rename",
      entity_type: "workspace",
      entity_id: data.workspaceId,
      details: { from: prev?.name ?? null, to: name },
    });
    return { ok: true };
  });


/** Delete the workspace. Owner only. Cascades via FK. */
export const deleteWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; confirmName: string }) => input)
  .handler(async ({ data, context }) => {
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

    // Log BEFORE delete so we retain workspace context; audit_logs has no FK to workspaces.
    await supabase.from("audit_logs").insert({
      user_id: userId,
      workspace_id: data.workspaceId,
      action: "workspace.delete",
      entity_type: "workspace",
      entity_id: data.workspaceId,
      details: { name: ws.name },
    });

    const { error } = await supabase.from("workspaces").delete().eq("id", data.workspaceId);
    if (error) throw error;

    // Move caller to another workspace if any
    const { data: other } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    await supabase.from("profiles").update({ active_workspace_id: other?.workspace_id ?? null }).eq("id", userId);

    return { ok: true, nextWorkspaceId: other?.workspace_id ?? null };
  });

/** Leave a workspace. Non-owners only. Switches active workspace if needed. */
export const leaveWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(async ({ data, context }) => {
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

    const { data: membership } = await supabase
      .from("workspace_members")
      .select("id, role")
      .eq("workspace_id", data.workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership) throw new Error("You are not a member of this workspace");

    const { error: delErr } = await supabase
      .from("workspace_members")
      .delete()
      .eq("workspace_id", data.workspaceId)
      .eq("user_id", userId);
    if (delErr) throw delErr;

    await supabase.from("audit_logs").insert({
      user_id: userId,
      workspace_id: data.workspaceId,
      action: "workspace.member_left",
      entity_type: "workspace_member",
      entity_id: membership.id,
      details: { workspace_name: ws.name, role: membership.role },
    });

    // If the workspace they left was the active one, pick another (or null)
    const { data: profile } = await supabase
      .from("profiles")
      .select("active_workspace_id")
      .eq("id", userId)
      .maybeSingle();

    let nextWorkspaceId: string | null = profile?.active_workspace_id ?? null;
    if (nextWorkspaceId === data.workspaceId) {
      const { data: other } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      nextWorkspaceId = other?.workspace_id ?? null;
      await supabase.from("profiles").update({ active_workspace_id: nextWorkspaceId }).eq("id", userId);
    }

    return { ok: true, nextWorkspaceId };
  });


