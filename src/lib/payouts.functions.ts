// Monthly partner payout generation and tracking.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { workspaceIdForPartner, requireActiveWorkspaceId } from "./workspace-helpers";
import { assertActiveWorkspaceRole } from "./authz.server";
import type { ServerContext } from "./server-context";
import type { PartnerRole } from "./partners.functions";

const PAYOUT_ROLES = ["owner", "admin"] as const;

// BUG FIX: the old formula only produces a valid date for a 10-char
// "YYYY-MM-DD" input — a 7-char "YYYY-MM" input comes out as "2026-0901",
// invalid. Same bug, same fix, as reliability.functions.ts /
// month-close.server.ts / statements.functions.ts / performance.functions.ts
// / brand.functions.ts / reconcile.functions.ts.
function monthStart(input?: string) {
  const base = input ?? new Date().toISOString().slice(0, 10);
  return base.slice(0, 7) + "-01";
}

export async function getPayoutSummaryCore(data: { month?: string }, context: ServerContext) {
  const month = monthStart(data.month);
  const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);

  const [partnersRes, extRes, payoutsRes] = await Promise.all([
    context.supabase.from("partners").select("id, name, role, store_id, phone, cnic, active").eq("workspace_id", wsId),
    context.supabase
      .from("extractions")
      .select("partner_id, commission_amount")
      .eq("workspace_id", wsId)
      .eq("status", "success")
      .eq("is_duplicate", false)
      .eq("commission_month", month)
      .not("partner_id", "is", null),
    context.supabase.from("partner_payouts").select("*").eq("workspace_id", wsId).eq("month", month),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const partners = (partnersRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (extRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payouts = (payoutsRes.data ?? []) as any[];

  const stats = new Map<string, { count: number; amount: number }>();
  for (const r of rows) {
    const s = stats.get(r.partner_id) ?? { count: 0, amount: 0 };
    s.count += 1;
    s.amount += r.commission_amount ?? 0;
    stats.set(r.partner_id, s);
  }
  const payoutByPartner = new Map<string, typeof payouts[number]>();
  for (const p of payouts) payoutByPartner.set(p.partner_id, p);

  const list = partners
    .map((p) => {
      const s = stats.get(p.id) ?? { count: 0, amount: 0 };
      const rate = s.count > 0 ? Math.round(s.amount / s.count) : 0;
      const payout = payoutByPartner.get(p.id);
      return {
        partner_id: p.id as string,
        name: p.name as string,
        role: p.role as PartnerRole,
        store_id: p.store_id as string | null,
        phone: p.phone as string | null,
        cnic: p.cnic as string | null,
        active: p.active as boolean,
        count: s.count,
        rate,
        amount: s.amount,
        payout_id: (payout?.id ?? null) as string | null,
        status: (payout?.status ?? (s.count > 0 ? "pending" : "none")) as string,
        paid_at: (payout?.paid_at ?? null) as string | null,
        payment_reference: (payout?.payment_reference ?? null) as string | null,
        notes: (payout?.notes ?? null) as string | null,
      };
    })
    .filter((r) => r.count > 0 || r.payout_id)
    .sort((a, b) => b.amount - a.amount || b.count - a.count);

  const totals = list.reduce(
    (acc, r) => {
      acc.partners += 1;
      acc.activations += r.count;
      acc.total += r.amount;
      if (r.status === "paid") acc.paid += r.amount;
      else acc.pending += r.amount;
      return acc;
    },
    { partners: 0, activations: 0, total: 0, paid: 0, pending: 0 }
  );

  return { month, rows: list, totals };
}

export const getPayoutSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month?: string }) => input)
  .handler(({ data, context }) => getPayoutSummaryCore(data, context));

export async function upsertPayoutCore(data: { partner_id: string; month: string; activations_count: number; rate_pkr: number; amount_pkr: number; status?: "pending" | "paid"; payment_reference?: string | null; notes?: string | null; }, context: ServerContext) {
  const callerWsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...PAYOUT_ROLES]);
  const month = monthStart(data.month);
  // The role check proves the caller manages *their* workspace; it says nothing
  // about the partner they named. Taking workspace_id from the partner without
  // comparing the two let an owner file a payout into another tenant's
  // workspace, with RLS as the only thing in the way.
  const wsId = await workspaceIdForPartner(context.supabase, data.partner_id);
  if (wsId !== callerWsId) throw new Error("Partner not found in this workspace");
  const patch = {
    partner_id: data.partner_id,
    workspace_id: wsId,
    month,
    activations_count: data.activations_count,
    rate_pkr: data.rate_pkr,
    amount_pkr: data.amount_pkr,
    status: data.status ?? "pending",
    payment_reference: data.payment_reference ?? null,
    notes: data.notes ?? null,
    paid_at: data.status === "paid" ? new Date().toISOString() : null,
    paid_by: data.status === "paid" ? context.userId : null,
  };
  const { data: row, error } = await context.supabase
    .from("partner_payouts")
    .upsert(patch, { onConflict: "partner_id,month" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return row;
}

export const upsertPayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    partner_id: string;
    month: string;
    activations_count: number;
    rate_pkr: number;
    amount_pkr: number;
    status?: "pending" | "paid";
    payment_reference?: string | null;
    notes?: string | null;
  }) => input)
  .handler(({ data, context }) => upsertPayoutCore(data, context));


export async function markPayoutStatusCore(data: { payout_id: string; status: "pending" | "paid"; payment_reference?: string | null }, context: ServerContext) {
  await assertActiveWorkspaceRole(context.supabase, context.userId, [...PAYOUT_ROLES]);
  const patch = {
    status: data.status,
    paid_at: data.status === "paid" ? new Date().toISOString() : null,
    paid_by: data.status === "paid" ? context.userId : null,
    ...(data.payment_reference !== undefined ? { payment_reference: data.payment_reference } : {}),
  };
  const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
  const { data: updated, error } = await context.supabase
    .from("partner_payouts")
    .update(patch)
    .eq("workspace_id", wsId)
    .eq("id", data.payout_id)
    .select("id");
  if (!error && (!updated || updated.length === 0)) throw new Error("Payout not found in the active workspace");
  if (error) throw new Error(error.message);
  return { ok: true };
}

export const markPayoutStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { payout_id: string; status: "pending" | "paid"; payment_reference?: string | null }) => input)
  .handler(({ data, context }) => markPayoutStatusCore(data, context));

export async function generatePayoutsForMonthCore(data: { month: string }, context: ServerContext) {
  await assertActiveWorkspaceRole(context.supabase, context.userId, [...PAYOUT_ROLES]);
  const month = monthStart(data.month);
  const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);

  const { data: rows } = await context.supabase
    .from("extractions")
    .select("partner_id, commission_amount")
    .eq("workspace_id", wsId)
    .eq("status", "success")
    .eq("is_duplicate", false)
    .eq("commission_month", month)
    .not("partner_id", "is", null);

  const stats = new Map<string, { count: number; amount: number }>();
  for (const r of (rows ?? []) as Array<{ partner_id: string; commission_amount: number | null }>) {
    const s = stats.get(r.partner_id) ?? { count: 0, amount: 0 };
    s.count += 1;
    s.amount += r.commission_amount ?? 0;
    stats.set(r.partner_id, s);
  }

  const { data: existing } = await context.supabase
    .from("partner_payouts")
    .select("partner_id, status")
    .eq("workspace_id", wsId)
    .eq("month", month);
  const existingMap = new Map<string, string>();
  for (const e of (existing ?? []) as Array<{ partner_id: string; status: string }>) {
    existingMap.set(e.partner_id, e.status);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const failed: Array<{ partner_id: string; error: string }> = [];
  for (const [partner_id, s] of stats) {
    const rate = s.count > 0 ? Math.round(s.amount / s.count) : 0;
    const existingStatus = existingMap.get(partner_id);
    if (existingStatus === "paid") {
      skipped += 1;
      continue;
    }
    // These partner ids came from a workspace-scoped extractions query, so
    // they are already this workspace's. The per-partner lookup this replaces
    // was a query per partner and shadowed the outer wsId.
    const patch = {
      partner_id,
      workspace_id: wsId,
      month,
      activations_count: s.count,
      rate_pkr: rate,
      amount_pkr: s.amount,
      status: "pending" as const,
      snapshot_count: s.count,
      snapshot_amount: s.amount,
      snapshot_at: new Date().toISOString(),
    };
    const { error } = await context.supabase
      .from("partner_payouts")
      .upsert(patch, { onConflict: "partner_id,month" });
    if (error) {
      // Previously an error incremented nothing at all, so a run that failed
      // half its writes still returned a tidy set of counts and the caller had
      // no way to tell which partners were missed.
      failed.push({ partner_id, error: error.message });
      continue;
    }
    if (existingStatus) updated += 1;
    else created += 1;
  }

  return { created, updated, skipped, failed, total: stats.size };
}

export const generatePayoutsForMonth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string }) => input)
  .handler(({ data, context }) => generatePayoutsForMonthCore(data, context));

/** Bulk mark all pending payouts for a month as paid. Owner/admin only. */
export async function bulkMarkPayoutsPaidCore(data: { month: string; partner_ids?: string[]; payment_reference?: string | null; }, context: ServerContext) {
  await assertActiveWorkspaceRole(context.supabase, context.userId, [...PAYOUT_ROLES]);
  const month = monthStart(data.month);

  // Gather partners with pending activity for the month
  const bulkWsId = await requireActiveWorkspaceId(context.supabase, context.userId);
  const { data: exts } = await context.supabase
    .from("extractions")
    .select("partner_id, commission_amount")
    .eq("workspace_id", bulkWsId)
    .eq("status", "success")
    .eq("is_duplicate", false)
    .eq("commission_month", month)
    .not("partner_id", "is", null);

  const stats = new Map<string, { count: number; amount: number }>();
  for (const r of (exts ?? []) as Array<{ partner_id: string; commission_amount: number | null }>) {
    const s = stats.get(r.partner_id) ?? { count: 0, amount: 0 };
    s.count += 1;
    s.amount += r.commission_amount ?? 0;
    stats.set(r.partner_id, s);
  }

  const filter = data.partner_ids?.length ? new Set(data.partner_ids) : null;
  const now = new Date().toISOString();
  let paid = 0;
  let skipped = 0;
  const failed: Array<{ partner_id: string; error: string }> = [];

  for (const [partner_id, s] of stats) {
    if (filter && !filter.has(partner_id)) { skipped += 1; continue; }
    const rate = s.count > 0 ? Math.round(s.amount / s.count) : 0;
    // These partner ids came from a workspace-scoped extractions query, so
    // they are already this workspace's. The per-partner lookup this replaces
    // was a query per partner and shadowed the outer workspace id.
    const patch = {
      partner_id,
      workspace_id: bulkWsId,
      month,
      activations_count: s.count,
      rate_pkr: rate,
      amount_pkr: s.amount,
      status: "paid" as const,
      paid_at: now,
      paid_by: context.userId,
      payment_reference: data.payment_reference ?? null,
    };
    const { error } = await context.supabase
      .from("partner_payouts")
      .upsert(patch, { onConflict: "partner_id,month" });
    if (error) {
      // Previously an error incremented nothing at all, so a run that failed
      // half its writes still returned a tidy set of counts and the caller had
      // no way to tell which partners were missed.
      failed.push({ partner_id, error: error.message });
      continue;
    }
    paid += 1;
  }
  return { paid, skipped, failed, total: stats.size };
}

export const bulkMarkPayoutsPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    month: string;
    partner_ids?: string[];
    payment_reference?: string | null;
  }) => input)
  .handler(({ data, context }) => bulkMarkPayoutsPaidCore(data, context));
