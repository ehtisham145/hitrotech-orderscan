import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { requireActiveWorkspaceId } from "@/lib/workspace-helpers";
import { PLANS, type PlanTier } from "@/lib/plans";
import type { ServerContext } from "./server-context";

// Each handler is a plain `<name>Core(data, context)` function with a one-line
// createServerFn wrapper under it — see src/lib/server-context.ts for why.

const PERIOD_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * Compute the current rolling 30-day billing period for a workspace.
 * Anchor = plan_activated_at (paid plans) or workspace created_at (free / never activated).
 * The window rolls forward every 30 days from the anchor — like a subscription anniversary,
 * not a calendar-month reset.
 */
function computePeriod(anchorIso: string): { start: Date; end: Date } {
  const anchor = new Date(anchorIso).getTime();
  const now = Date.now();
  const elapsed = Math.max(0, now - anchor);
  const periods = Math.floor(elapsed / (PERIOD_DAYS * DAY_MS));
  const start = new Date(anchor + periods * PERIOD_DAYS * DAY_MS);
  const end = new Date(start.getTime() + PERIOD_DAYS * DAY_MS);
  return { start, end };
}

// BUG FIX: this error was discarded — a failed query silently fell back to
// "not a super admin" (fails safe/restrictive, so not a security hole, but
// worth surfacing distinctly rather than hiding a real DB failure).
async function isSuperAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

/**
 * Unlimited usage applies to a super admin only inside their OWN workspaces.
 * When they enter another account's workspace they operate under that
 * workspace's plan, exactly as its owner would.
 */
async function hasUnlimitedUsage(supabase: any, userId: string, workspaceId: string): Promise<boolean> {
  if (!(await isSuperAdmin(supabase, userId))) return false;
  // BUG FIX: this error was discarded too — same reasoning as isSuperAdmin.
  const { data: membership, error } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!membership;
}

// BUG FIX: this is the serious one. Both queries' errors were discarded:
// - the workspace lookup's failure defaulted the anchor to "right now"
//   (new Date().toISOString()), silently shifting the whole 30-day billing
//   window on a transient DB hiccup instead of failing.
// - the extractions count's failure defaulted `used` to 0 — and
//   checkActivationBudgetCore below trusts this `used` figure to decide
//   whether an import should be blocked. A failed count query would report
//   "0 used", which always passes the budget check — a failed query, not a
//   deliberate plan choice, would let a workspace import past its actual
//   plan limit with no error at all.
async function loadUsage(supabase: any, workspaceId: string, superAdmin: boolean) {
  const { data: ws, error: wsErr } = await supabase
    .from("workspaces")
    .select("plan_tier, plan_activated_at, plan_expires_at, created_at")
    .eq("id", workspaceId)
    .maybeSingle();
  if (wsErr) throw new Error(wsErr.message);

  const anchor = ws?.plan_activated_at || ws?.created_at || new Date().toISOString();
  const { start, end } = computePeriod(anchor);

  const { count, error: countErr } = await supabase
    .from("extractions")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gte("created_at", start.toISOString());
  if (countErr) throw new Error(countErr.message);

  const tier = (ws?.plan_tier ?? "free") as PlanTier;
  const plan = PLANS.find((p) => p.id === tier) ?? PLANS[0];
  const planExpired =
    tier !== "free" &&
    tier !== "enterprise" &&
    !!ws?.plan_expires_at &&
    new Date(ws.plan_expires_at) < new Date();

  const limit = superAdmin ? null : plan.activationsPerMonth; // null = unlimited
  const used = Number(count ?? 0);
  const remaining = limit === null ? Infinity : Math.max(0, limit - used);
  return {
    used,
    limit,
    remaining,
    planTier: tier,
    planName: superAdmin ? "Super Admin (unlimited)" : plan.name,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    planExpired,
    planExpiresAt: ws?.plan_expires_at ?? null,
  };
}

/** Fire a notification once per workspace+action+period to workspace owners/admins. */
async function notifyWorkspaceAdmins(
  supabase: any,
  workspaceId: string,
  action: string,
  title: string,
  body: string,
  periodStart: string,
) {
  // Dedupe: check if any notification with this action for this workspace since periodStart exists.
  const { data: existing } = await supabase
    .from("notifications")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("action", action)
    .gte("created_at", periodStart)
    .limit(1);
  if (existing && existing.length > 0) return;

  const { data: admins } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .in("role", ["owner", "admin"]);
  const userIds: string[] = (admins ?? []).map((r: any) => r.user_id).filter(Boolean);
  if (userIds.length === 0) return;

  await supabase.from("notifications").insert(
    userIds.map((user_id) => ({
      user_id,
      workspace_id: workspaceId,
      action,
      title,
      body,
      entity_type: "billing",
      data: { periodStart },
    })),
  );
}

/** Read current-period activation usage for the caller's active workspace. */
export async function getActivationUsageCore(context: ServerContext) {
  const { supabase, userId } = context;
  const workspaceId = await requireActiveWorkspaceId(supabase, userId);
  // Unlimited only inside their own workspaces; while impersonating another
  // account they operate under that workspace's plan.
  const sa = await hasUnlimitedUsage(supabase, userId, workspaceId);
  const u = await loadUsage(supabase, workspaceId, sa);

  // Fire notifications for state transitions (best-effort, deduped).
  if (!sa) {
    try {
      if (u.planExpired) {
        await notifyWorkspaceAdmins(
          supabase,
          workspaceId,
          "plan_expired",
          "Your plan has expired",
          `Your ${u.planName} plan expired. Renew to keep using paid features.`,
          u.periodStart,
        );
      }
      if (u.limit !== null && u.used >= u.limit) {
        await notifyWorkspaceAdmins(
          supabase,
          workspaceId,
          "activation_limit_reached",
          "Activation limit reached",
          `You've used all ${u.limit.toLocaleString()} activations for this 30-day period. Upgrade or wait until ${new Date(u.periodEnd).toLocaleDateString()}.`,
          u.periodStart,
        );
      } else if (u.limit !== null && u.used / u.limit >= 0.8) {
        await notifyWorkspaceAdmins(
          supabase,
          workspaceId,
          "activation_limit_warning",
          "Approaching activation limit",
          `You've used ${u.used.toLocaleString()} of ${u.limit.toLocaleString()} activations this period. Resets on ${new Date(u.periodEnd).toLocaleDateString()}.`,
          u.periodStart,
        );
      }
    } catch {
      // Non-fatal — usage read must not fail on notification error.
    }
  }

  return {
    used: u.used,
    limit: u.limit,
    remaining: Number.isFinite(u.remaining) ? u.remaining : null,
    planTier: u.planTier,
    planName: u.planName,
    periodStart: u.periodStart,
    periodEnd: u.periodEnd,
    planExpired: u.planExpired,
  };
}

export const getActivationUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => getActivationUsageCore(context));

/**
 * Preflight check before starting an import.
 * Throws with a friendly message when the requested count would exceed the plan cap.
 */
export async function checkActivationBudgetCore(data: { requested: number }, context: ServerContext) {
  const { supabase, userId } = context;
  const workspaceId = await requireActiveWorkspaceId(supabase, userId);
  const sa = await hasUnlimitedUsage(supabase, userId, workspaceId);
  const u = await loadUsage(supabase, workspaceId, sa);
  const requested = Math.max(0, Math.floor(data.requested));

  if (u.limit === null) return { ok: true, used: u.used, limit: null, remaining: null };

  if (requested > u.remaining) {
    try {
      await notifyWorkspaceAdmins(
        supabase,
        workspaceId,
        "activation_limit_reached",
        "Activation limit reached",
        `Import blocked: ${u.remaining} activations remain until ${new Date(u.periodEnd).toLocaleDateString()}.`,
        u.periodStart,
      );
    } catch {
      /* non-fatal */
    }
    throw new Error(
      u.remaining === 0
        ? `Your ${u.planName} plan's activation limit (${u.limit}) has been reached for this 30-day period. It resets on ${new Date(u.periodEnd).toLocaleDateString()}, or upgrade to import more now.`
        : `Your ${u.planName} plan allows ${u.limit} activations per 30-day period and only ${u.remaining} remain (resets ${new Date(u.periodEnd).toLocaleDateString()}) — you're trying to import ${requested}. Upgrade to add more, or split this import.`,
    );
  }
  return { ok: true, used: u.used, limit: u.limit, remaining: u.remaining - requested };
}

export const checkActivationBudget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { requested: number }) => input)
  .handler(({ data, context }) => checkActivationBudgetCore(data, context));
