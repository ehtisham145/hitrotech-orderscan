// Month-close: freeze a month's payouts + brand invoice, or reopen it.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { assertActiveWorkspaceRole } from "./authz.server";
import { requireActiveWorkspaceId } from "./workspace-helpers";
import { runMonthClose, monthStartOf } from "./month-close.server";
import type { ServerContext } from "./server-context";

// Each handler is a plain `<name>Core(data, context)` function with a one-line
// createServerFn wrapper under it — see src/lib/server-context.ts for why.

const CLOSE_ROLES = ["owner", "admin"] as const;

export type MonthCloseRow = {
  id: string;
  month: string;
  status: string;
  activations_count: number;
  partner_cost_pkr: number;
  brand_revenue_pkr: number;
  margin_pkr: number;
  payouts_created: number;
  closed_automatically: boolean;
  created_at: string;
};

// BUG FIX: neither closeRes.error nor lockRes.error was checked. A failed
// query here silently reported "no close record" / "not locked" — the
// second of which gates whether a month can still be edited, so a failed
// lock lookup could wrongly tell the caller a locked month was open.
export async function getMonthCloseCore(data: { month?: string }, context: ServerContext) {
  const month = monthStartOf(data.month);
  const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
  const [closeRes, lockRes] = await Promise.all([
    context.supabase.from("month_closes").select("*").eq("workspace_id", wsId).eq("month", month).maybeSingle(),
    context.supabase.from("month_locks").select("*").eq("workspace_id", wsId).eq("month", month).maybeSingle(),
  ]);
  if (closeRes.error) throw new Error(closeRes.error.message);
  if (lockRes.error) throw new Error((lockRes.error as { message: string }).message);
  return {
    month,
    close: (closeRes.data ?? null) as MonthCloseRow | null,
    locked: Boolean(lockRes.data),
  };
}

export const getMonthClose = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month?: string }) => input)
  .handler(({ data, context }) => getMonthCloseCore(data, context));

// BUG FIX: the query's `error` was never even destructured, so a failed
// fetch silently returned an empty list — indistinguishable from a
// workspace that genuinely has no closed months yet.
export async function listMonthClosesCore(context: ServerContext) {
  const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
  const { data, error } = await context.supabase
    .from("month_closes")
    .select("*")
    .eq("workspace_id", wsId)
    .order("month", { ascending: false })
    .limit(24);
  if (error) throw new Error(error.message);
  return (data ?? []) as MonthCloseRow[];
}

export const listMonthCloses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => listMonthClosesCore(context));

export async function closeMonthNowCore(data: { month: string; lock?: boolean }, context: ServerContext) {
  const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...CLOSE_ROLES]);
  const result = await runMonthClose(context.supabase as any, wsId, data.month, {
    closedBy: context.userId,
    automatic: false,
    lock: data.lock !== false,
  });
  // The close itself already happened by this point (runMonthClose has
  // succeeded) — an audit-log failure here shouldn't be reported as the
  // close having failed (that would invite a confusing retry of an
  // operation that actually went through). It's still worth knowing about,
  // so it's logged rather than silently discarded as it was before.
  const { error: auditErr } = await context.supabase.from("audit_logs").insert({
    user_id: context.userId,
    workspace_id: wsId,
    action: "month.closed",
    entity_type: "month_close",
    entity_id: null,
    details: result,
  });
  if (auditErr) console.error("[month-close] Could not write audit log for month.closed:", auditErr.message);
  return { ok: true as const, ...result };
}

export const closeMonthNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string; lock?: boolean }) => input)
  .handler(({ data, context }) => closeMonthNowCore(data, context));

// BUG FIX: none of the three writes here checked their error — not even by
// destructuring it. If the month_closes update or the month_locks delete
// failed, the function fell straight through to the next step and still
// returned { ok: true }, telling the caller a month was reopened when it
// might not have been touched at all.
export async function reopenMonthCore(data: { month: string }, context: ServerContext) {
  const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...CLOSE_ROLES]);
  const month = monthStartOf(data.month);

  const { error: closeErr } = await context.supabase.from("month_closes").update({ status: "open" }).eq("workspace_id", wsId).eq("month", month);
  if (closeErr) throw new Error(closeErr.message);

  const { error: lockErr } = await context.supabase.from("month_locks").delete().eq("workspace_id", wsId).eq("month", month);
  if (lockErr) throw new Error(lockErr.message);

  // Same reasoning as closeMonthNowCore: the reopen itself already
  // succeeded by this point, so an audit-log failure is logged, not thrown.
  const { error: auditErr } = await context.supabase.from("audit_logs").insert({
    user_id: context.userId,
    workspace_id: wsId,
    action: "month.reopened",
    entity_type: "month_close",
    entity_id: null,
    details: { month },
  });
  if (auditErr) console.error("[month-close] Could not write audit log for month.reopened:", auditErr.message);

  return { ok: true as const };
}

export const reopenMonth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string }) => input)
  .handler(({ data, context }) => reopenMonthCore(data, context));
