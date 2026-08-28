// Monthly partner payout generation and tracking.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { workspaceIdForPartner, requireActiveWorkspaceId } from "./workspace-helpers";
import { assertActiveWorkspaceRole } from "./authz.server";
import type { PartnerRole } from "./partners.functions";

const PAYOUT_ROLES = ["owner", "admin"] as const;

function monthStart(input?: string) {
  const s = (input ?? new Date().toISOString().slice(0, 8) + "01").slice(0, 8) + "01";
  return s;
}

export const getPayoutSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month?: string }) => input)
  .handler(async ({ data, context }) => {
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
  });

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
  .handler(async ({ data, context }) => {
    await assertActiveWorkspaceRole(context.supabase, context.userId, [...PAYOUT_ROLES]);
    const month = monthStart(data.month);
    const wsId = await workspaceIdForPartner(context.supabase, data.partner_id);
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
  });


export const markPayoutStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { payout_id: string; status: "pending" | "paid"; payment_reference?: string | null }) => input)
  .handler(async ({ data, context }) => {
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
  });

export const generatePayoutsForMonth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string }) => input)
  .handler(async ({ data, context }) => {
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
    for (const [partner_id, s] of stats) {
      const rate = s.count > 0 ? Math.round(s.amount / s.count) : 0;
      const existingStatus = existingMap.get(partner_id);
      if (existingStatus === "paid") {
        skipped += 1;
        continue;
      }
      const wsId = await workspaceIdForPartner(context.supabase, partner_id);
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
      if (!error) {
        if (existingStatus) updated += 1;
        else created += 1;
      }
    }

    return { created, updated, skipped, total: stats.size };
  });

/** Bulk mark all pending payouts for a month as paid. Owner/admin only. */
export const bulkMarkPayoutsPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    month: string;
    partner_ids?: string[];
    payment_reference?: string | null;
  }) => input)
  .handler(async ({ data, context }) => {
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

    for (const [partner_id, s] of stats) {
      if (filter && !filter.has(partner_id)) { skipped += 1; continue; }
      const rate = s.count > 0 ? Math.round(s.amount / s.count) : 0;
      const wsId = await workspaceIdForPartner(context.supabase, partner_id);
      const patch = {
        partner_id,
        workspace_id: wsId,
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
      if (!error) paid += 1;
    }
    return { paid, skipped, total: stats.size };
  });
