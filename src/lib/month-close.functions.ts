// Month-close: freeze a month's payouts + brand invoice, or reopen it.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { assertActiveWorkspaceRole } from "./authz.server";
import { requireActiveWorkspaceId } from "./workspace-helpers";
import { runMonthClose, monthStartOf } from "./month-close.server";

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

export const getMonthClose = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month?: string }) => input)
  .handler(async ({ data, context }) => {
    const month = monthStartOf(data.month);
    const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
    const [closeRes, lockRes] = await Promise.all([
      (context.supabase as any).from("month_closes").select("*").eq("workspace_id", wsId).eq("month", month).maybeSingle(),
      (context.supabase as any).from("month_locks").select("*").eq("workspace_id", wsId).eq("month", month).maybeSingle(),
    ]);
    return {
      month,
      close: (closeRes.data ?? null) as MonthCloseRow | null,
      locked: Boolean(lockRes.data),
    };
  });

export const listMonthCloses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
    const { data } = await (context.supabase as any)
      .from("month_closes")
      .select("*")
      .eq("workspace_id", wsId)
      .order("month", { ascending: false })
      .limit(24);
    return (data ?? []) as MonthCloseRow[];
  });

export const closeMonthNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string; lock?: boolean }) => input)
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...CLOSE_ROLES]);
    const result = await runMonthClose(context.supabase as any, wsId, data.month, {
      closedBy: context.userId,
      automatic: false,
      lock: data.lock !== false,
    });
    await (context.supabase as any).from("audit_logs").insert({
      user_id: context.userId,
      workspace_id: wsId,
      action: "month.closed",
      entity_type: "month_close",
      entity_id: null,
      details: result,
    });
    return { ok: true as const, ...result };
  });

export const reopenMonth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string }) => input)
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...CLOSE_ROLES]);
    const month = monthStartOf(data.month);
    await (context.supabase as any).from("month_closes").update({ status: "open" }).eq("workspace_id", wsId).eq("month", month);
    await (context.supabase as any).from("month_locks").delete().eq("workspace_id", wsId).eq("month", month);
    await (context.supabase as any).from("audit_logs").insert({
      user_id: context.userId,
      workspace_id: wsId,
      action: "month.reopened",
      entity_type: "month_close",
      entity_id: null,
      details: { month },
    });
    return { ok: true as const };
  });
