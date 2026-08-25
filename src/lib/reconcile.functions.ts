// Money reconciliation: what we owe partners vs what we actually paid,
// and what the brand owes us vs what we actually received.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { assertActiveWorkspaceRole } from "./authz.server";
import { requireActiveWorkspaceId } from "./workspace-helpers";

const WRITE_ROLES = ["owner", "admin"] as const;

function monthStart(input?: string) {
  return ((input ?? new Date().toISOString().slice(0, 8) + "01").slice(0, 8) + "01") as string;
}

export type LedgerRow = {
  partner_id: string;
  name: string;
  role: string;
  count: number;
  owed: number;
  paid: number;
  outstanding: number;
  status: "unpaid" | "partial" | "settled" | "overpaid";
  last_paid_on: string | null;
};

export type PaymentRow = {
  id: string;
  partner_id: string;
  month: string;
  amount_pkr: number;
  paid_on: string;
  method: string;
  reference: string | null;
  notes: string | null;
  created_at: string;
};

/** Per-partner owed / paid / outstanding for a month, plus the brand side. */
export const getPaymentLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month?: string }) => input)
  .handler(async ({ data, context }) => {
    const month = monthStart(data.month);
    const supabase = context.supabase as any;

    const [extRes, partnersRes, paymentsRes, invoiceRes, receiptsRes] = await Promise.all([
      supabase
        .from("extractions")
        .select("partner_id, commission_amount")
        .eq("status", "success")
        .eq("is_duplicate", false)
        .eq("commission_month", month)
        .not("partner_id", "is", null),
      supabase.from("partners").select("id, name, role"),
      supabase.from("payout_payments").select("*").eq("month", month),
      supabase.from("brand_invoices").select("*").eq("month", month).maybeSingle(),
      supabase.from("brand_receipts").select("*").eq("month", month),
    ]);

    const partners = (partnersRes.data ?? []) as any[];
    const nameById = new Map<string, any>(partners.map((p) => [p.id, p]));

    const owedBy = new Map<string, { count: number; amount: number }>();
    for (const r of (extRes.data ?? []) as any[]) {
      const s = owedBy.get(r.partner_id) ?? { count: 0, amount: 0 };
      s.count += 1;
      s.amount += r.commission_amount ?? 0;
      owedBy.set(r.partner_id, s);
    }

    const payments = (paymentsRes.data ?? []) as PaymentRow[];
    const paidBy = new Map<string, { amount: number; last: string | null }>();
    for (const p of payments) {
      const e = paidBy.get(p.partner_id) ?? { amount: 0, last: null };
      e.amount += Number(p.amount_pkr) || 0;
      if (!e.last || p.paid_on > e.last) e.last = p.paid_on;
      paidBy.set(p.partner_id, e);
    }

    const ids = new Set<string>([...owedBy.keys(), ...paidBy.keys()]);
    const rows: LedgerRow[] = Array.from(ids)
      .map((id) => {
        const o = owedBy.get(id) ?? { count: 0, amount: 0 };
        const p = paidBy.get(id) ?? { amount: 0, last: null };
        const outstanding = o.amount - p.amount;
        const status: LedgerRow["status"] =
          p.amount <= 0 ? "unpaid" : outstanding > 0.5 ? "partial" : outstanding < -0.5 ? "overpaid" : "settled";
        return {
          partner_id: id,
          name: (nameById.get(id)?.name as string) ?? "Unknown",
          role: (nameById.get(id)?.role as string) ?? "",
          count: o.count,
          owed: o.amount,
          paid: p.amount,
          outstanding,
          status,
          last_paid_on: p.last,
        };
      })
      .sort((a, b) => b.outstanding - a.outstanding || b.owed - a.owed);

    const totals = rows.reduce(
      (acc, r) => {
        acc.owed += r.owed;
        acc.paid += r.paid;
        acc.outstanding += r.outstanding;
        acc.activations += r.count;
        if (r.status === "settled") acc.settled += 1;
        return acc;
      },
      { owed: 0, paid: 0, outstanding: 0, activations: 0, settled: 0 },
    );

    const invoice = (invoiceRes.data ?? null) as any;
    const receipts = (receiptsRes.data ?? []) as any[];
    const receivedTotal = receipts.reduce((s, r) => s + (Number(r.amount_pkr) || 0), 0);
    const invoiced = Number(invoice?.amount_pkr ?? 0);

    return {
      month,
      rows,
      totals,
      payments,
      brand: {
        brand_id: (invoice?.brand_id ?? null) as string | null,
        invoice_id: (invoice?.id ?? null) as string | null,
        invoiced,
        received: receivedTotal,
        outstanding: invoiced - receivedTotal,
        receipts,
      },
      net_position: totals.paid === 0 && receivedTotal === 0 ? 0 : receivedTotal - totals.paid,
    };
  });

export const recordPayoutPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      partner_id: string;
      month: string;
      amount_pkr: number;
      paid_on?: string;
      method?: string;
      reference?: string | null;
      notes?: string | null;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    if (!(data.amount_pkr > 0)) return { ok: false as const, error: "Amount must be greater than zero" };
    const { error } = await (context.supabase as any).from("payout_payments").insert({
      workspace_id: wsId,
      partner_id: data.partner_id,
      month: monthStart(data.month),
      amount_pkr: data.amount_pkr,
      paid_on: data.paid_on ?? new Date().toISOString().slice(0, 10),
      method: data.method ?? "bank",
      reference: data.reference ?? null,
      notes: data.notes ?? null,
      created_by: context.userId,
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const deletePayoutPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const { error } = await (context.supabase as any).from("payout_payments").delete().eq("id", data.id);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const recordBrandReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      brand_id: string;
      month: string;
      amount_pkr: number;
      received_on?: string;
      method?: string;
      reference?: string | null;
      notes?: string | null;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    if (!(data.amount_pkr > 0)) return { ok: false as const, error: "Amount must be greater than zero" };
    const { error } = await (context.supabase as any).from("brand_receipts").insert({
      workspace_id: wsId,
      brand_id: data.brand_id,
      month: monthStart(data.month),
      amount_pkr: data.amount_pkr,
      received_on: data.received_on ?? new Date().toISOString().slice(0, 10),
      method: data.method ?? "bank",
      reference: data.reference ?? null,
      notes: data.notes ?? null,
      created_by: context.userId,
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const deleteBrandReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const { error } = await (context.supabase as any).from("brand_receipts").delete().eq("id", data.id);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

/** Brands available for recording receipts in the active workspace. */
export const listReceiptBrands = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
    const { data } = await (context.supabase as any)
      .from("brands")
      .select("id, name, active")
      .eq("workspace_id", wsId)
      .order("created_at", { ascending: true });
    return (data ?? []) as Array<{ id: string; name: string; active: boolean }>;
  });
