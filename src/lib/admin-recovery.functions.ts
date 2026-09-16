import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";

import type { ServerContext } from "./server-context";

type Role = "owner" | "admin" | "manager" | "employee" | "partner";

async function getActiveWorkspaceIdFor(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("active_workspace_id").eq("id", userId).maybeSingle();
  if (!data?.active_workspace_id) throw new Error("No active workspace");
  return data.active_workspace_id as string;
}

/** Verify caller is owner/admin of the workspace and target is a member. */
export async function assertCanRecoverMember(supabase: any, callerId: string, targetUserId: string) {
  if (callerId === targetUserId) throw new Error("Use your own settings page to manage your account");

  const wsId = await getActiveWorkspaceIdFor(supabase, callerId);

  const { data: callerMember } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", wsId)
    .eq("user_id", callerId)
    .maybeSingle();
  if (!callerMember || !["owner", "admin"].includes(callerMember.role)) {
    throw new Error("Only workspace owner or admin can recover member access");
  }

  const { data: targetMember } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", wsId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (!targetMember) throw new Error("User is not a member of this workspace");
  if (targetMember.role === "owner") throw new Error("Cannot reset the workspace owner from here");

  return { workspaceId: wsId, callerRole: callerMember.role as Role, targetRole: targetMember.role as Role };
}

export async function getMemberSecurityStatusCore(data: any, context: ServerContext) {
  const { supabase, userId } = context;
  await assertCanRecoverMember(supabase, userId, data.memberUserId);

  const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");

  const [profRes, codesRes, factorsRes, userRes] = await Promise.all([
    supabaseAdmin.from("profiles").select("email, full_name, email_2fa_enabled").eq("id", data.memberUserId).maybeSingle(),
    supabaseAdmin.from("user_recovery_codes").select("used_at").eq("user_id", data.memberUserId),
    supabaseAdmin.auth.admin.mfa.listFactors({ userId: data.memberUserId }).catch(() => ({ data: { factors: [] } })),
    supabaseAdmin.auth.admin.getUserById(data.memberUserId).catch(() => ({ data: { user: null } })),
  ]);

  const codes = codesRes.data ?? [];
  const totpFactors = (factorsRes as any).data?.factors?.filter((f: any) => f.factor_type === "totp" && f.status === "verified").length ?? 0;

  return {
    email: profRes.data?.email ?? null,
    fullName: profRes.data?.full_name ?? null,
    email2faEnabled: !!profRes.data?.email_2fa_enabled,
    totpFactors,
    recoveryCodesTotal: codes.length,
    recoveryCodesRemaining: codes.filter((c: any) => !c.used_at).length,
    lastSignInAt: (userRes as any).data?.user?.last_sign_in_at ?? null,
  };
}

export const getMemberSecurityStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ memberUserId: z.string().uuid() }).parse(d))
  .handler(({ data, context }) => getMemberSecurityStatusCore(data, context));

export async function resetMemberTwoFactorCore(data: any, context: ServerContext) {
  const { supabase, userId } = context;
  const { workspaceId } = await assertCanRecoverMember(supabase, userId, data.memberUserId);

  const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");

  await supabaseAdmin.from("profiles").update({ email_2fa_enabled: false }).eq("id", data.memberUserId);
  try {
    const { data: fdata } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId: data.memberUserId });
    for (const f of fdata?.factors ?? []) {
      await supabaseAdmin.auth.admin.mfa.deleteFactor({ userId: data.memberUserId, id: f.id });
    }
  } catch (err) {
    console.error("resetMemberTwoFactor: listFactors failed", err);
  }
  
  await supabaseAdmin.from("user_recovery_codes").delete().eq("user_id", data.memberUserId);

  await supabaseAdmin.from("audit_logs").insert({
    user_id: userId,
    workspace_id: workspaceId,
    action: "member.security_reset",
    entity_type: "user",
    entity_id: data.memberUserId,
    details: { reset_by: userId },
  });

  return { ok: true };
}

export const resetMemberTwoFactor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ memberUserId: z.string().uuid() }).parse(d))
  .handler(({ data, context }) => resetMemberTwoFactorCore(data, context));

export async function sendMemberPasswordResetCore(data: any, context: ServerContext) {
  const { supabase, userId } = context;
  const { workspaceId } = await assertCanRecoverMember(supabase, userId, data.memberUserId);

  const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");

  let targetEmail: string | null = null;

  if (data.newEmail) {
    const newEmail = data.newEmail.trim().toLowerCase();
    const { data: updated, error } = await supabaseAdmin.auth.admin.updateUserById(data.memberUserId, {
      email: newEmail,
      email_confirm: true, // admin override: bypass confirmation
    });
    if (error) throw new Error(error.message);
    // Mirror on profile. This was unchecked: if it failed, auth held the new
    // address while profiles still held the old one, so the admin saw the
    // change apparently not take while sign-in had already moved. A divergence
    // between those two is worth failing loudly for.
    const { error: mirrorErr } = await supabaseAdmin
      .from("profiles").update({ email: newEmail }).eq("id", data.memberUserId);
    if (mirrorErr) {
      throw new Error(
        `Sign-in email was changed to ${newEmail}, but the profile record could not be updated: ${mirrorErr.message}`,
      );
    }
    targetEmail = updated.user?.email ?? newEmail;

    await supabaseAdmin.from("audit_logs").insert({
      user_id: userId,
      workspace_id: workspaceId,
      action: "member.email_changed",
      entity_type: "user",
      entity_id: data.memberUserId,
      details: { new_email: newEmail, changed_by: userId },
    });
  } else {
    const { data: userRow } = await supabaseAdmin.auth.admin.getUserById(data.memberUserId);
    targetEmail = userRow?.user?.email ?? null;
  }

  if (!targetEmail) throw new Error("Could not resolve target email");

  // Generate a recovery link and send it via the app's Resend gateway (same as auth emails)
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email: targetEmail,
    options: { redirectTo: `${data.origin}/auth` },
  });
  if (linkErr || !linkData) throw new Error("Could not generate reset link");

  const actionLink = (linkData.properties as { action_link?: string } | null)?.action_link;
  if (!actionLink) throw new Error("No reset link produced");

  // Whether the mail actually went out is reported back rather than assumed:
  // this used to return ok even when no key was configured or the send threw,
  // so an admin was told the member had been emailed when nothing had been
  // sent. The reset link is already valid by this point, so it is information
  // for the caller rather than a failure.
  let emailSent = false;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (RESEND_API_KEY) {
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,.06)">
        <tr><td style="background:linear-gradient(135deg,#e63946,#f4a261);padding:22px 28px;color:#fff">
          <div style="font-size:18px;font-weight:700">HitroTech Telecom · OrderScan</div>
        </td></tr>
        <tr><td style="padding:32px 28px">
          <h1 style="margin:0 0 8px 0;font-size:22px">Account access restored</h1>
          <p style="color:#475569;line-height:1.55">Your workspace administrator reset your sign-in. Click the button below to set a new password and continue.</p>
          <p style="margin:24px 0"><a href="${actionLink}" style="display:inline-block;background:#e63946;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Set a new password</a></p>
          <p style="color:#64748b;font-size:13px">If you didn't expect this, please contact your workspace administrator.</p>
        </td></tr>
      </table>
    </td></tr></table></body></html>`;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: "HitroTech <no-reply@orders.hitrotech.com>",
          to: [targetEmail],
          subject: "Reset your HitroTech password",
          html,
        }),
      });
      emailSent = res.ok;
      if (!res.ok) {
        console.error("password reset email rejected", res.status, await res.text().catch(() => ""));
      }
    } catch (err) {
      console.error("password reset email failed", err);
    }
  }

  return { ok: true, email: targetEmail, emailSent };
}

export const sendMemberPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      memberUserId: z.string().uuid(),
      newEmail: z.string().email().optional().nullable(),
      origin: z.string().url(),
    }).parse(d),
  )
  .handler(({ data, context }) => sendMemberPasswordResetCore(data, context));
