import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";

/** Public lookup: return workspace name for a pending invite by email. */
export async function lookupInviteCore(data: any) {
  const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");
  const email = data.email.trim().toLowerCase();
  const { data: row } = await supabaseAdmin
    .from("workspace_invites")
    .select("role, expires_at, workspaces:workspaces(name)")
    .eq("email", email)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row) return { found: false as const };
  return {
    found: true as const,
    role: row.role as string,
    workspaceName: (row.workspaces as any)?.name ?? "a workspace",
  };
}

export const lookupInvite = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ email: z.string().email() }).parse(d))
  .handler(({ data }) => lookupInviteCore(data));


import type { ServerContext } from "./server-context";

type Role = "owner" | "admin" | "manager" | "employee" | "operator" | "accountant" | "partner";

async function getActiveWorkspaceIdFor(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("active_workspace_id").eq("id", userId).maybeSingle();
  if (!data?.active_workspace_id) throw new Error("No active workspace");
  return data.active_workspace_id as string;
}

async function assertWorkspaceRole(supabase: any, userId: string, workspaceId: string, roles: Role[]) {
  const { data: superRow } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
  if (superRow) return "super_admin" as const;
  
  const { data } = await supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  if (!data || !roles.includes(data.role as Role)) throw new Error("Forbidden");
  return data.role as Role;
}

/** List members of the active workspace (with profile info). */
export async function listWorkspaceMembersCore(context: ServerContext) {
  const { supabase, userId } = context;
  const wsId = await getActiveWorkspaceIdFor(supabase, userId);

  const [membersRes, invitesRes] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("id, user_id, role, created_at")
      .eq("workspace_id", wsId)
      .order("created_at", { ascending: true }),
    supabase
      .from("workspace_invites")
      .select("id, email, role, created_at, expires_at, accepted_at")
      .eq("workspace_id", wsId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  if (membersRes.error) throw new Error(membersRes.error.message);

  const memberRows = (membersRes.data ?? []) as Array<{ id: string; user_id: string; role: Role; created_at: string }>;
  const userIds = Array.from(new Set(memberRows.map((m) => m.user_id)));
  const { data: profs } = userIds.length
    ? await supabase.from("profiles").select("id, email, full_name").in("id", userIds)
    : { data: [] as Array<{ id: string; email: string | null; full_name: string | null }> };
  const pmap = new Map((profs ?? []).map((p) => [p.id, p]));

  const { data: ws } = await supabase.from("workspaces").select("id, name, owner_id").eq("id", wsId).maybeSingle();
  return {
    workspace: ws,
    members: memberRows.map((m) => {
      const prof = pmap.get(m.user_id);
      return {
        id: m.id,
        userId: m.user_id,
        role: m.role,
        createdAt: m.created_at,
        email: prof?.email ?? null,
        fullName: prof?.full_name ?? null,
        isOwner: !!(ws && m.user_id === (ws as any).owner_id),
      };
    }),
    invites: (invitesRes.data ?? []).map((i: any) => ({
      id: i.id as string,
      email: i.email as string,
      role: i.role as Role,
      createdAt: i.created_at as string,
      expiresAt: i.expires_at as string,
    })),
  };
}

export const listWorkspaceMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => listWorkspaceMembersCore(context));

/** Update a member's role. Owner/admin/super_admin only. Cannot change the owner. */
export async function updateMemberRoleCore(data: any, context: ServerContext) {
  const { supabase, userId } = context;
  const wsId = await getActiveWorkspaceIdFor(supabase, userId);
  const userRole = await assertWorkspaceRole(supabase, userId, wsId, ["owner", "admin"]);
  const callerIsSuper = userRole === "super_admin";

  // Prevent changing the owner
  const { data: row } = await supabase.from("workspace_members").select("user_id, workspace_id, role").eq("id", data.memberId).maybeSingle();
  if (!row) throw new Error("Member not found");
  if (row.workspace_id !== wsId) throw new Error("Wrong workspace");
  const { data: ws } = await supabase.from("workspaces").select("owner_id").eq("id", wsId).maybeSingle();
  if (ws?.owner_id === row.user_id && !callerIsSuper) throw new Error("Cannot change the owner's role. Transfer ownership first.");

  const { error } = await supabase.from("workspace_members").update({ role: data.role }).eq("id", data.memberId);
  if (error) throw error;

  await supabase.from("audit_logs").insert({
    user_id: userId,
    workspace_id: wsId,
    action: "workspace.member_role_updated",
    entity_type: "workspace_member",
    entity_id: data.memberId,
    details: { target_user_id: row.user_id, from: row.role, to: data.role },
  });
  return { ok: true };
}

export const updateMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      memberId: z.string().uuid(),
      role: z.enum(["admin", "manager", "employee", "operator", "accountant", "partner"]),
    }).parse(d),
  )
  .handler(({ data, context }) => updateMemberRoleCore(data, context));

/** Remove a member from the workspace. Cannot remove the owner. */
export async function removeMemberCore(data: any, context: ServerContext) {
  const { supabase, userId } = context;
  const wsId = await getActiveWorkspaceIdFor(supabase, userId);
  const userRole = await assertWorkspaceRole(supabase, userId, wsId, ["owner", "admin"]);
  const callerIsSuper = userRole === "super_admin";

  const { data: row } = await supabase.from("workspace_members").select("user_id, workspace_id, role").eq("id", data.memberId).maybeSingle();
  if (!row) throw new Error("Member not found");
  if (row.workspace_id !== wsId) throw new Error("Wrong workspace");
  const { data: ws } = await supabase.from("workspaces").select("owner_id").eq("id", wsId).maybeSingle();
  if (ws?.owner_id === row.user_id && !callerIsSuper) throw new Error("Cannot remove the owner. Transfer ownership first.");

  const { error } = await supabase.from("workspace_members").delete().eq("id", data.memberId);
  if (error) throw error;

  await supabase.from("audit_logs").insert({
    user_id: userId,
    workspace_id: wsId,
    action: "workspace.member_removed",
    entity_type: "workspace_member",
    entity_id: data.memberId,
    details: { target_user_id: row.user_id, role: row.role },
  });
  return { ok: true };
}

export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ memberId: z.string().uuid() }).parse(d))
  .handler(({ data, context }) => removeMemberCore(data, context));

/** Invite a person by email to the active workspace. Owner/admin only. */
export async function inviteMemberCore(data: any, context: ServerContext) {
  const { supabase, userId } = context;
  const wsId = await getActiveWorkspaceIdFor(supabase, userId);
  await assertWorkspaceRole(supabase, userId, wsId, ["owner", "admin"]);

  const email = data.email.trim().toLowerCase();

  // Seat cap enforcement (counts active members + pending non-expired invites).
  // Super admins bypass seat caps.
  const { data: superRow } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
  if (!superRow) {
    const { data: usage } = await supabase.rpc("workspace_seat_usage", { _ws: wsId }).maybeSingle();
    if (usage) {
      const seatsUsed = Number(usage.seats_used ?? 0);
      const seatLimit = Number(usage.seat_limit ?? 0);
      if (seatLimit > 0 && seatsUsed >= seatLimit) {
        throw new Error(
          `Seat limit reached: this workspace's ${usage.plan_tier} plan allows ${seatLimit} seat${seatLimit === 1 ? "" : "s"} (currently using ${seatsUsed}). Remove a member, revoke a pending invite, or upgrade the plan to invite more people.`,
        );
      }
    }
  }

  const { data: inviteRow, error } = await supabase.from("workspace_invites").insert({
    workspace_id: wsId,
    email,
    role: data.role,
    invited_by: userId,
  }).select("id").single();
  if (error) throw error;

  // Fetch workspace + inviter info for the email
  const [{ data: ws }, { data: inviter }] = await Promise.all([
    supabase.from("workspaces").select("name").eq("id", wsId).maybeSingle(),
    supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle(),
  ]);

  // Send email via Resend connector gateway (non-fatal if it fails)
  let emailSent = false;
  let emailError: string | null = null;
  try {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      throw new Error("Resend not configured");
    }
    const origin = data.origin ?? process.env.APP_URL ?? "http://localhost:3000";
    const inviteUrl = `${origin.replace(/\/$/, "")}/auth?invite=${encodeURIComponent(email)}`;
    const wsName = ws?.name ?? "a workspace";
    const inviterName = inviter?.full_name || inviter?.email || "A teammate";
    const from = process.env.INVITE_FROM_EMAIL || "HitroTech OrderScan <onboarding@resend.dev>";

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a1a">
        <h1 style="font-size:22px;margin:0 0 12px">You're invited to ${escapeHtml(wsName)}</h1>
        <p style="font-size:15px;line-height:1.55;color:#444">
          ${escapeHtml(inviterName)} has invited you to join <strong>${escapeHtml(wsName)}</strong>
          on HitroTech OrderScan as a <strong>${data.role}</strong>.
        </p>
        <p style="margin:24px 0">
          <a href="${inviteUrl}" style="display:inline-block;background:#0f172a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">
            Accept invitation
          </a>
        </p>
        <p style="font-size:13px;color:#666;line-height:1.5">
          Sign up using this email address (<strong>${escapeHtml(email)}</strong>) and you'll be added to the workspace automatically.
        </p>
        <p style="font-size:12px;color:#999;margin-top:32px">This invitation expires in 14 days.</p>
      </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: `You're invited to ${wsName}`,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend ${res.status}: ${body}`);
    }
    emailSent = true;
  } catch (e) {
    emailError = e instanceof Error ? e.message : String(e);
    console.error("invite email failed:", emailError);
  }

  await supabase.from("audit_logs").insert({
    user_id: userId,
    workspace_id: wsId,
    action: "workspace.invite_sent",
    entity_type: "workspace_invite",
    entity_id: inviteRow.id,
    details: { email, role: data.role, emailSent, emailError },
  });

  return { ok: true, emailSent, emailError };
}

export const inviteMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      email: z.string().email(),
      role: z.enum(["admin", "manager", "employee", "operator", "accountant", "partner"]),
      origin: z.string().url().optional(),
    }).parse(d),
  )
  .handler(({ data, context }) => inviteMemberCore(data, context));

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/** Resend an existing pending invite email and extend its expiry by 14 days. */
export async function resendInviteCore(data: any, context: ServerContext) {
  const { supabase, userId } = context;
  const wsId = await getActiveWorkspaceIdFor(supabase, userId);
  await assertWorkspaceRole(supabase, userId, wsId, ["owner", "admin"]);

  const { data: inv, error: invErr } = await supabase
    .from("workspace_invites")
    .select("id, email, role, accepted_at, workspace_id")
    .eq("id", data.inviteId)
    .eq("workspace_id", wsId)
    .maybeSingle();
  if (invErr) throw invErr;
  if (!inv) throw new Error("Invite not found");
  if (inv.accepted_at) throw new Error("Invite has already been accepted");

  const newExpiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const { error: upErr } = await supabase
    .from("workspace_invites")
    .update({ expires_at: newExpiry })
    .eq("id", inv.id);
  if (upErr) throw upErr;

  const [{ data: ws }, { data: inviter }] = await Promise.all([
    supabase.from("workspaces").select("name").eq("id", wsId).maybeSingle(),
    supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle(),
  ]);

  let emailSent = false;
  let emailError: string | null = null;
  try {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) throw new Error("Resend not configured");
    const origin = data.origin ?? process.env.APP_URL ?? "http://localhost:3000";
    const inviteUrl = `${origin.replace(/\/$/, "")}/auth?invite=${encodeURIComponent(inv.email)}`;
    const wsName = ws?.name ?? "a workspace";
    const inviterName = inviter?.full_name || inviter?.email || "A teammate";
    const from = process.env.INVITE_FROM_EMAIL || "HitroTech OrderScan <onboarding@resend.dev>";

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a1a">
        <h1 style="font-size:22px;margin:0 0 12px">Reminder: you're invited to ${escapeHtml(wsName)}</h1>
        <p style="font-size:15px;line-height:1.55;color:#444">
          ${escapeHtml(inviterName)} is re-sending an invitation to join <strong>${escapeHtml(wsName)}</strong>
          on HitroTech OrderScan as a <strong>${inv.role}</strong>.
        </p>
        <p style="margin:24px 0">
          <a href="${inviteUrl}" style="display:inline-block;background:#0f172a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">
            Accept invitation
          </a>
        </p>
        <p style="font-size:13px;color:#666;line-height:1.5">
          Sign up using this email address (<strong>${escapeHtml(inv.email)}</strong>) and you'll be added to the workspace automatically.
        </p>
        <p style="font-size:12px;color:#999;margin-top:32px">This invitation expires in 14 days.</p>
      </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from,
        to: [inv.email],
        subject: `Reminder: you're invited to ${wsName}`,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend ${res.status}: ${body}`);
    }
    emailSent = true;
  } catch (e) {
    emailError = e instanceof Error ? e.message : String(e);
    console.error("resend invite email failed:", emailError);
  }

  await supabase.from("audit_logs").insert({
    user_id: userId,
    workspace_id: wsId,
    action: "workspace.invite_resent",
    entity_type: "workspace_invite",
    entity_id: inv.id,
    details: { email: inv.email, role: inv.role, emailSent, emailError, newExpiresAt: newExpiry },
  });

  return { ok: true, emailSent, emailError };
}

export const resendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ inviteId: z.string().uuid(), origin: z.string().url().optional() }).parse(d))
  .handler(({ data, context }) => resendInviteCore(data, context));


/** Revoke a pending invite. */
export async function revokeInviteCore(data: any, context: ServerContext) {
  const { supabase, userId } = context;
  const wsId = await getActiveWorkspaceIdFor(supabase, userId);
  await assertWorkspaceRole(supabase, userId, wsId, ["owner", "admin"]);

  const { data: inv } = await supabase.from("workspace_invites").select("email, role").eq("id", data.inviteId).eq("workspace_id", wsId).maybeSingle();
  const { error } = await supabase.from("workspace_invites").delete().eq("id", data.inviteId).eq("workspace_id", wsId);
  if (error) throw error;
  await supabase.from("audit_logs").insert({
    user_id: userId,
    workspace_id: wsId,
    action: "workspace.invite_revoked",
    entity_type: "workspace_invite",
    entity_id: data.inviteId,
    details: { email: inv?.email ?? null, role: inv?.role ?? null },
  });
  return { ok: true };
}

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ inviteId: z.string().uuid() }).parse(d))
  .handler(({ data, context }) => revokeInviteCore(data, context));

/** Transfer ownership to another member. Current owner only. */
export async function transferOwnershipCore(data: any, context: ServerContext) {
  const { supabase, userId } = context;
  const wsId = await getActiveWorkspaceIdFor(supabase, userId);

  const { data: ws } = await supabase.from("workspaces").select("owner_id").eq("id", wsId).maybeSingle();
  const { data: superRow } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
  if (ws?.owner_id !== userId && !superRow) throw new Error("Only the current owner can transfer ownership.");

  // Ensure target is a member
  const { data: target } = await supabase.from("workspace_members").select("id").eq("workspace_id", wsId).eq("user_id", data.newOwnerUserId).maybeSingle();
  if (!target) throw new Error("Target user is not a member of this workspace.");

  const previousOwnerId = ws?.owner_id ?? userId;

  // Transferring to whoever already owns it is not a no-op, it is corrupting:
  // the writes below set the new owner's role to "owner" and then set the
  // previous owner's role to "admin", and when those are the same person the
  // second overwrites the first. The workspace would end up with owner_id
  // pointing at a member whose role is "admin" — an owner locked out of the
  // checks that read that role.
  if (data.newOwnerUserId === previousOwnerId) {
    throw new Error("That user already owns this workspace.");
  }

  const { error: e1 } = await supabase.from("workspaces").update({ owner_id: data.newOwnerUserId }).eq("id", wsId);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from("workspace_members").update({ role: "owner" }).eq("workspace_id", wsId).eq("user_id", data.newOwnerUserId);
  if (e2) throw e2;
  // Demote previous owner to admin
  const { error: e3 } = await supabase.from("workspace_members").update({ role: "admin" }).eq("workspace_id", wsId).eq("user_id", previousOwnerId);
  if (e3) throw e3;

  await supabase.from("audit_logs").insert({
    user_id: userId,
    workspace_id: wsId,
    action: "workspace.ownership_transferred",
    entity_type: "workspace",
    entity_id: wsId,
    details: { from_user_id: previousOwnerId, to_user_id: data.newOwnerUserId },
  });
  return { ok: true };
}

export const transferOwnership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ newOwnerUserId: z.string().uuid() }).parse(d))
  .handler(({ data, context }) => transferOwnershipCore(data, context));

/** Super-admin: list all workspaces with member counts. */
export async function listAllWorkspacesCore(context: ServerContext) {
  const { supabase, userId } = context;
  const { data: superRow } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
  if (!superRow) throw new Error("Forbidden");

  // Super admins are scoped by RLS to their active workspace, so the platform-wide
  // listing must run with the service-role client (after the check above).
  const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");

  const { data: workspaces, error: wsError } = await supabaseAdmin
    .from("workspaces")
    .select("id, name, slug, owner_id, created_at, plan_tier, seat_limit")
    .order("created_at", { ascending: false });
  if (wsError) throw new Error(wsError.message);

  const wsList = workspaces ?? [];
  const ownerIds = Array.from(new Set(wsList.map((w) => w.owner_id)));
  const [{ data: profs }, { data: members }, { data: superRoles }] = await Promise.all([
    supabaseAdmin.from("profiles").select("id, email, full_name").in("id", ownerIds.length ? ownerIds : ["00000000-0000-0000-0000-000000000000"]),
    supabaseAdmin.from("workspace_members").select("workspace_id"),
    supabaseAdmin.from("user_roles").select("user_id").eq("role", "super_admin"),
  ]);
  const pmap = new Map((profs ?? []).map((p: any) => [p.id, p]));
  const superAdminIds = new Set((superRoles ?? []).map((r: any) => r.user_id));
  const counts = new Map<string, number>();
  (members ?? []).forEach((m: any) => counts.set(m.workspace_id, (counts.get(m.workspace_id) ?? 0) + 1));

  return wsList.map((w: any) => ({
    id: w.id,
    name: w.name,
    slug: w.slug,
    owner_id: w.owner_id,
    createdAt: w.created_at,
    memberCount: counts.get(w.id) ?? 0,
    planTier: (superAdminIds.has(w.owner_id) ? "enterprise" : (w.plan_tier ?? "free")) as string,
    seatLimit: w.seat_limit as number,
    owner: pmap.get(w.owner_id) ?? null,
  }));
}

export const listAllWorkspaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => listAllWorkspacesCore(context));

/** Current-workspace billing summary: plan + seat usage. Any member can view. */
export async function getWorkspaceBillingCore(context: ServerContext) {
  const { supabase, userId } = context;
  const wsId = await getActiveWorkspaceIdFor(supabase, userId);
  // Any member can view; assert membership only
  await assertWorkspaceRole(supabase, userId, wsId, ["owner", "admin", "manager", "employee", "operator", "accountant", "partner"]);
  const { data: usage } = await supabase.rpc("workspace_seat_usage", { _ws: wsId }).maybeSingle();
  return {
    workspaceId: wsId,
    planTier: (usage?.plan_tier ?? "free") as "free" | "starter" | "pro" | "enterprise",
    seatLimit: Number(usage?.seat_limit ?? 0),
    seatsUsed: Number(usage?.seats_used ?? 0),
    membersCount: Number(usage?.members_count ?? 0),
    pendingInvites: Number(usage?.pending_invites ?? 0),
  };
}

export const getWorkspaceBilling = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => getWorkspaceBillingCore(context));

/** Super-admin: change a workspace's plan tier and seat cap. */
export async function updateWorkspacePlanCore(data: any, context: ServerContext) {
  const { supabase, userId } = context;
  const { data: superRow } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
  if (!superRow) throw new Error("Forbidden");

  const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");
  const { data: before } = await supabaseAdmin.from("workspaces").select("plan_tier, seat_limit").eq("id", data.workspaceId).maybeSingle();
  // Stamp the activation and clear any expiry left over from a previous term.
  // Without this, a workspace granted a paid tier here kept whatever
  // plan_expires_at it already had — frequently a date in the past — and every
  // feature check reads the plan through effectivePlanTier (CLAUDE.md 2.x), so
  // the grant would have registered as already expired. An admin grant has no
  // term of its own, which a null expiry is how this schema says.
  const { error } = await supabaseAdmin
    .from("workspaces")
    .update({
      plan_tier: data.planTier,
      seat_limit: data.seatLimit,
      plan_activated_at: new Date().toISOString(),
      plan_expires_at: null,
    })
    .eq("id", data.workspaceId);
  if (error) throw error;

  await supabase.from("audit_logs").insert({
    user_id: userId,
    workspace_id: data.workspaceId,
    action: "workspace.plan_updated",
    entity_type: "workspace",
    entity_id: data.workspaceId,
    details: {
      from: before ?? null,
      to: { plan_tier: data.planTier, seat_limit: data.seatLimit },
    },
  });
  return { ok: true };
}

export const updateWorkspacePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      workspaceId: z.string().uuid(),
      planTier: z.enum(["free", "starter", "pro", "enterprise"]),
      seatLimit: z.number().int().min(1).max(10000),
    }).parse(d),
  )
  .handler(({ data, context }) => updateWorkspacePlanCore(data, context));
