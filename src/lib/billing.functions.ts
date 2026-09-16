import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { z } from "zod";
import { PLANS, computeProration, type PlanTier } from "@/lib/plans";
import type { ServerContext } from "./server-context";

// ---------- Billing settings (bank details) ----------

export async function getBillingSettingsCore(context: ServerContext) {
  const { data, error } = await context.supabase
    .from("billing_settings")
    .select("*")
    .eq("id", "global")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export const getBillingSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => getBillingSettingsCore(context));

const updateSchema = z.object({
  bank_name: z.string().max(120),
  account_title: z.string().max(200),
  account_number: z.string().max(80),
  iban: z.string().max(80),
  branch: z.string().max(200),
  branch_code: z.string().max(40),
  instructions: z.string().max(2000),
  contact_email: z.string().max(200),
  contact_whatsapp: z.string().max(80),
});

export async function updateBillingSettingsCore(data: z.infer<typeof updateSchema>, context: ServerContext) {
  const { data: isSuper, error: roleError } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (roleError) throw roleError;
  if (!isSuper) throw new Error("Only super admin can update billing settings");

  // The caller is now verified as a super admin. Use the server-only client
  // for this privileged singleton write so table grants/RLS cannot turn it
  // into a silent no-op.
  const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");
  // (Was written as a ternary on `await context.supabase` — an object, so
  // always truthy, and the else branch was unreachable.)
  const { data: saved, error } = await supabaseAdmin
    .from("billing_settings")
    .upsert({ id: "global", ...data } as never, { onConflict: "id" })
    .select("*")
    .single();
  if (error) throw error;
  if (!saved) throw new Error("Billing settings were not saved (no row written).");
  return saved;
}

export const updateBillingSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof updateSchema>) => updateSchema.parse(d))
  .handler(({ data, context }) => updateBillingSettingsCore(data, context));


// ---------- Proration quoting ----------

/**
 * Builds a price quote for moving a workspace onto `targetTier` for `months`.
 * Credits back the unused portion of the current paid plan on upgrades, and
 * schedules downgrades to start when the current, richer term expires.
 */
export async function quoteForWorkspace(
  supabase: any,
  workspaceId: string,
  targetTier: PlanTier,
  months: number,
) {
  const { data: ws, error } = await supabase
    .from("workspaces")
    .select("plan_tier, plan_expires_at, plan_activated_at")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw error;

  // What they actually paid for the current term, and when that term started.
  const { data: lastPaid } = await supabase
    .from("billing_requests")
    .select("amount_pkr, gross_pkr, months, plan_tier, reviewed_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "approved")
    .eq("plan_tier", ws?.plan_tier ?? "free")
    .order("reviewed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const paidMonthly =
    lastPaid && lastPaid.months > 0
      ? Math.round((lastPaid.gross_pkr ?? lastPaid.amount_pkr) / lastPaid.months)
      : null;

  return computeProration({
    currentTier: ws?.plan_tier ?? "free",
    currentExpiresAt: ws?.plan_expires_at ?? null,
    currentTermStart: lastPaid?.reviewed_at ?? ws?.plan_activated_at ?? null,
    currentPaidTotal: lastPaid?.gross_pkr ?? lastPaid?.amount_pkr ?? null,
    currentPaidMonthly: paidMonthly,
    targetTier,
    months,
  });
}

const quoteSchema = z.object({
  workspaceId: z.string().uuid(),
  planTier: z.enum(["free", "starter", "pro"]),
  months: z.number().int().min(1).max(12),
});

export async function getPlanChangeQuoteCore(data: z.infer<typeof quoteSchema>, context: ServerContext) {
  const { data: canManage } = await context.supabase.rpc("has_workspace_role", {
    _ws: data.workspaceId,
    _roles: ["owner", "admin"],
    _user_id: context.userId,
  });
  if (!canManage) throw new Error("Only workspace owners/admins can change the plan");
  return quoteForWorkspace(context.supabase, data.workspaceId, data.planTier, data.months);
}

export const getPlanChangeQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof quoteSchema>) => quoteSchema.parse(d))
  .handler(({ data, context }) => getPlanChangeQuoteCore(data, context));

// ---------- Billing requests ----------

const createReqSchema = z.object({
  workspaceId: z.string().uuid(),
  planTier: z.enum(["free", "starter", "pro"]),
  paymentReference: z.string().max(200).optional().nullable(),
  payerNote: z.string().max(2000).optional().nullable(),
  months: z.number().int().min(1).max(12).default(1),
  receiptPath: z.string().max(500).optional().nullable(),
});

export async function createBillingRequestCore(data: z.infer<typeof createReqSchema>, context: ServerContext) {
  // Verify caller is owner/admin of the workspace
  const { data: canManage } = await context.supabase.rpc("has_workspace_role", {
    _ws: data.workspaceId,
    _roles: ["owner", "admin"],
    _user_id: context.userId,
  });
  if (!canManage) throw new Error("Only workspace owners/admins can request a plan");

  const plan = PLANS.find((p) => p.id === data.planTier);
  if (!plan || plan.pricePkr == null) throw new Error("Invalid plan");

  // Free has no term — always a single, immediate switch.
  if (data.planTier === "free") data.months = 1;

  // Price the change server-side so the client can never dictate the amount.
  const quote = await quoteForWorkspace(context.supabase, data.workspaceId, data.planTier, data.months);

  const { data: row, error } = await context.supabase
    .from("billing_requests")
    .insert({
      workspace_id: data.workspaceId,
      requested_by: context.userId,
      plan_tier: data.planTier,
      amount_pkr: quote.total,
      gross_pkr: quote.subtotal,
      credit_pkr: quote.credit,
      change_type: quote.changeType,
      effective_from: quote.startsAt,
      months: data.months,
      payment_reference: data.paymentReference ?? null,
      payer_note: data.payerNote ?? null,
      receipt_path: data.receiptPath ?? null,
    } as never)
    .select("id")
    .single();
  if (error) throw error;

  // Nothing left to pay (the unused credit covers the new term, e.g. a
  // downgrade where we owe the customer): apply the plan change right away.
  // When money is due, the plan only moves after an admin confirms payment.
  if (quote.total <= 0) {
    const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");
    const now = new Date();
    const expires = new Date(now);
    expires.setMonth(expires.getMonth() + data.months);

    const { error: wsErr } = await supabaseAdmin
      .from("workspaces")
      .update({
        plan_tier: data.planTier,
        plan_activated_at: now.toISOString(),
        plan_expires_at: data.planTier === "free" ? null : expires.toISOString(),
        seat_limit: plan.seatLimit,
        scheduled_plan_tier: null,
        scheduled_starts_at: null,
        scheduled_months: null,
      } as never)
      .eq("id", data.workspaceId);
    if (wsErr) throw wsErr;

    const { error: reqErr } = await supabaseAdmin
      .from("billing_requests")
      .update({
        status: "approved",
        reviewed_at: now.toISOString(),
        admin_note: "Auto-applied — no payment due (credit covered this change).",
      } as never)
      .eq("id", (row as any).id);
    if (reqErr) throw reqErr;

    return { id: (row as any).id as string, autoApplied: true };
  }

  return { id: (row as any).id as string, autoApplied: false };
}

export const createBillingRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof createReqSchema>) => createReqSchema.parse(d))
  .handler(({ data, context }) => createBillingRequestCore(data, context));

export async function listWorkspaceBillingRequestsCore(data: { workspaceId: string }, context: ServerContext) {
  // workspaceId comes from the caller, so it has to be checked before it is
  // trusted — createBillingRequest and getPlanChangeQuote both do this and
  // this one did not, leaving RLS as the only thing between a member of one
  // workspace and another workspace's invoice amounts, payment references and
  // payer notes. has_workspace_role also returns true for super_admin, so the
  // admin fallback below still works.
  const { data: canView } = await context.supabase.rpc("has_workspace_role", {
    _ws: data.workspaceId,
    _roles: ["owner", "admin"],
    _user_id: context.userId,
  });
  if (!canView) throw new Error("Only workspace owners/admins can view billing requests");

  const { data: rows, error } = await context.supabase
    .from("billing_requests")
    .select("*")
    .eq("workspace_id", data.workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  if ((rows ?? []).length === 0) {
    const { data: isSuper } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
    if (isSuper) {
      const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");
      const { data: adminRows } = await supabaseAdmin
        .from("billing_requests")
        .select("*")
        .eq("workspace_id", data.workspaceId)
        .order("created_at", { ascending: false });
      return (adminRows ?? []) as any[];
    }
  }
  return rows ?? [];
}

export const listWorkspaceBillingRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspaceId: string }) =>
    z.object({ workspaceId: z.string().uuid() }).parse(d),
  )
  .handler(({ data, context }) => listWorkspaceBillingRequestsCore(data, context));


export async function listAllBillingRequestsCore(context: ServerContext) {
  const { data: isSuper } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (!isSuper) throw new Error("Forbidden");
  const { data: rows, error } = await context.supabase
    .from("billing_requests")
    .select("*, workspaces(name, slug)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.requested_by).filter(Boolean)));
  let profilesById: Record<string, { email: string | null; full_name: string | null }> = {};
  if (userIds.length > 0) {
    const { data: profs } = await context.supabase
      .from("profiles")
      .select("id, email, full_name")
      .in("id", userIds);
    profilesById = Object.fromEntries((profs ?? []).map((p: any) => [p.id, { email: p.email, full_name: p.full_name }]));
  }
  return (rows ?? []).map((r: any) => ({ ...r, profiles: profilesById[r.requested_by] ?? null }));
}

export const listAllBillingRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => listAllBillingRequestsCore(context));

const decideSchema = z.object({
  requestId: z.string().uuid(),
  adminNote: z.string().max(2000).optional().nullable(),
});

export async function approveBillingRequestCore(data: z.infer<typeof decideSchema>, context: ServerContext) {
  const { error } = await context.supabase.rpc("approve_billing_request", {
    _request_id: data.requestId,
    _admin_note: data.adminNote ?? undefined,
  });
  if (error) throw error;
  return { ok: true };
}

export const approveBillingRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof decideSchema>) => decideSchema.parse(d))
  .handler(({ data, context }) => approveBillingRequestCore(data, context));

export async function rejectBillingRequestCore(data: z.infer<typeof decideSchema>, context: ServerContext) {
  const { error } = await context.supabase.rpc("reject_billing_request", {
    _request_id: data.requestId,
    _admin_note: data.adminNote ?? undefined,
  });
  if (error) throw error;
  return { ok: true };
}

export const rejectBillingRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof decideSchema>) => decideSchema.parse(d))
  .handler(({ data, context }) => rejectBillingRequestCore(data, context));

export async function getWorkspacePlanCore(data: { workspaceId: string }, context: ServerContext) {
  let { data: ws, error } = await context.supabase
    .from("workspaces")
    .select("*")
    .eq("id", data.workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!ws) {
    // Super admins can inspect any workspace, including ones they are not a member of.
    const { data: isSuper } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
    if (isSuper) {
      const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");
      const res = await supabaseAdmin.from("workspaces").select("*").eq("id", data.workspaceId).maybeSingle();
      ws = res.data as any;
    }
  }
  if (!ws) return null;
  const row = ws as Record<string, unknown>;

  return {
    id: row["id"] as string,
    name: row["name"] as string,
    plan_tier: (row["plan_tier"] ?? "free") as PlanTier,
    plan_activated_at: (row["plan_activated_at"] ?? null) as string | null,
    plan_expires_at: (row["plan_expires_at"] ?? null) as string | null,
    seat_limit: (row["seat_limit"] ?? 2) as number,
    scheduled_plan_tier: (row["scheduled_plan_tier"] ?? null) as PlanTier | null,
    scheduled_starts_at: (row["scheduled_starts_at"] ?? null) as string | null,
    scheduled_months: (row["scheduled_months"] ?? null) as number | null,
  };
}

export const getWorkspacePlan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspaceId: string }) =>
    z.object({ workspaceId: z.string().uuid() }).parse(d),
  )
  .handler(({ data, context }) => getWorkspacePlanCore(data, context));

// ---------- Refund requests ----------

const refundSchema = z.object({
  workspaceId: z.string().uuid(),
  amountPkr: z.number().int().min(0),
  reason: z.string().max(2000).optional().nullable(),
  bankDetails: z.string().max(1000).optional().nullable(),
});

export async function createRefundRequestCore(data: z.infer<typeof refundSchema>, context: ServerContext) {
  const { data: canManage } = await context.supabase.rpc("has_workspace_role", {
    _ws: data.workspaceId,
    _roles: ["owner", "admin"],
    _user_id: context.userId,
  });
  if (!canManage) throw new Error("Only workspace owners/admins can request a refund");

  // Price the refund server-side: it can never exceed the unused value of
  // the current paid term.
  const { data: ws } = await context.supabase
    .from("workspaces")
    .select("plan_tier, plan_expires_at")
    .eq("id", data.workspaceId)
    .maybeSingle();

  const quote = await quoteForWorkspace(
    context.supabase,
    data.workspaceId,
    ((ws as any)?.plan_tier ?? "starter") as PlanTier,
    1,
  );
  const amount = Math.min(data.amountPkr, quote.unusedValue);
  if (amount <= 0) throw new Error("There is no unused balance to refund right now.");

  const { data: row, error } = await context.supabase
    .from("refund_requests")
    .insert({
      workspace_id: data.workspaceId,
      requested_by: context.userId,
      amount_pkr: amount,
      plan_tier: (ws as any)?.plan_tier ?? null,
      unused_days: quote.creditDays,
      reason: data.reason ?? null,
      bank_details: data.bankDetails ?? null,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  return { id: (row as any).id as string, amount };
}

export const createRefundRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof refundSchema>) => refundSchema.parse(d))
  .handler(({ data, context }) => createRefundRequestCore(data, context));

export async function listWorkspaceRefundRequestsCore(data: { workspaceId: string }, context: ServerContext) {
  const { data: rows, error } = await context.supabase
    .from("refund_requests")
    .select("*")
    .eq("workspace_id", data.workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  if ((rows ?? []).length === 0) {
    const { data: isSuper } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
    if (isSuper) {
      const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");
      const { data: adminRows } = await supabaseAdmin
        .from("refund_requests")
        .select("*")
        .eq("workspace_id", data.workspaceId)
        .order("created_at", { ascending: false });
      return (adminRows ?? []) as any[];
    }
  }
  return (rows ?? []) as any[];
}

export const listWorkspaceRefundRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspaceId: string }) =>
    z.object({ workspaceId: z.string().uuid() }).parse(d),
  )
  .handler(({ data, context }) => listWorkspaceRefundRequestsCore(data, context));


export async function listAllRefundRequestsCore(context: ServerContext) {
  const { data: isSuper } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (!isSuper) throw new Error("Forbidden");
  const { data: rows, error } = await context.supabase
    .from("refund_requests")
    .select("*, workspaces(name, slug)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (rows ?? []) as any[];
}

export const listAllRefundRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => listAllRefundRequestsCore(context));

const decideRefundSchema = z.object({
  requestId: z.string().uuid(),
  status: z.enum(["approved", "rejected", "paid"]),
  adminNote: z.string().max(2000).optional().nullable(),
});

export async function decideRefundRequestCore(data: z.infer<typeof decideRefundSchema>, context: ServerContext) {
  const { data: isSuper } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (!isSuper) throw new Error("Forbidden");
  const { error } = await context.supabase
    .from("refund_requests")
    .update({
      status: data.status,
      admin_note: data.adminNote ?? null,
      reviewed_by: context.userId,
      reviewed_at: new Date().toISOString(),
    } as never)
    .eq("id", data.requestId);
  if (error) throw error;
  return { ok: true };
}

export const decideRefundRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof decideRefundSchema>) => decideRefundSchema.parse(d))
  .handler(({ data, context }) => decideRefundRequestCore(data, context));

export type BillingRequestRow = {

  id: string;
  workspace_id: string;
  requested_by: string;
  plan_tier: PlanTier;
  amount_pkr: number;
  months: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  payment_reference: string | null;
  payer_note: string | null;
  receipt_path: string | null;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};
