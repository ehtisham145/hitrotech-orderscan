// Agency brand: what the operator pays the agency, vs what the agency pays partners.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { assertActiveWorkspaceRole } from "./authz.server";
import { computeSlabAmount, type Slab } from "./brand-slabs";
import { requireActiveWorkspaceId } from "./workspace-helpers";

const WRITE_ROLES = ["owner", "admin"] as const;

/* eslint-disable @typescript-eslint/no-explicit-any */

function monthStart(input?: string) {
  return ((input ?? new Date().toISOString().slice(0, 8) + "01").slice(0, 8) + "01") as string;
}

export type BrandRow = {
  id: string;
  name: string;
  operator: string | null;
  active: boolean;
  notes: string | null;
};

export const listBrands = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("brands")
      .select("*")
      .eq("workspace_id", await requireActiveWorkspaceId(context.supabase, context.userId))
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as BrandRow[];
  });

export const upsertBrand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string; name: string; operator?: string | null; active?: boolean; notes?: string | null }) => input)
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    if (data.id) {
      const { id, ...rest } = data;
      const { error } = await (context.supabase as any).from("brands").update(rest).eq("workspace_id", wsId).eq("id", id);
      if (error) return { ok: false as const, error: error.message };
      return { ok: true as const, id };
    }
    const { data: row, error } = await (context.supabase as any)
      .from("brands")
      .insert({ ...data, workspace_id: wsId })
      .select("id")
      .single();
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, id: row.id as string };
  });

export const deleteBrand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const { error } = await (context.supabase as any).from("brands").delete().eq("workspace_id", wsId).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listBrandSlabs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { brand_id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any)
      .from("brand_slabs")
      .select("*")
      .eq("workspace_id", await requireActiveWorkspaceId(context.supabase, context.userId))
      .eq("brand_id", data.brand_id)
      .order("min_count", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as (Slab & { id: string; brand_id: string })[];
  });

export const upsertBrandSlab = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { id?: string; brand_id: string; min_count: number; max_count: number | null; rate_pkr: number; active: boolean }) => input,
  )
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    if (data.id) {
      const { id, ...rest } = data;
      const { error } = await (context.supabase as any).from("brand_slabs").update(rest).eq("workspace_id", wsId).eq("id", id);
      if (error) return { ok: false as const, error: error.message };
      return { ok: true as const };
    }
    const { error } = await (context.supabase as any).from("brand_slabs").insert({ ...data, workspace_id: wsId });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const deleteBrandSlab = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const { error } = await (context.supabase as any).from("brand_slabs").delete().eq("workspace_id", wsId).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Agency roll-up for a month: every partner's activations counted together,
 * priced with the brand slabs, minus what the partners are owed.
 */
export const getAgencyEarnings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month?: string; brand_id?: string }) => input)
  .handler(async ({ data, context }) => {
    const month = monthStart(data.month);

    const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);

    const [brandsRes, extRes, partnersRes, employeesRes] = await Promise.all([
      (context.supabase as any).from("brands").select("*").eq("workspace_id", wsId).order("created_at", { ascending: true }),
      context.supabase
        .from("extractions")
        .select("partner_id, commission_amount")
        .eq("workspace_id", wsId)
        .eq("status", "success")
        .eq("is_duplicate", false)
        .eq("commission_month", month),
      context.supabase.from("partners").select("id, name, role, store_id").eq("workspace_id", wsId),
      context.supabase.from("employees").select("salary").eq("workspace_id", wsId),
    ]);



    const brands = (brandsRes.data ?? []) as BrandRow[];
    const brand = data.brand_id ? brands.find((b) => b.id === data.brand_id) : brands.find((b) => b.active) ?? brands[0];

    const rows = (extRes.data ?? []) as any[];
    const partners = (partnersRes.data ?? []) as any[];
    const partnerMap = new Map<string, any>(partners.map((p) => [p.id, p]));

    // Agency-wide totals: every activation counts, assigned or not.
    const totalActivations = rows.length;
    const partnerCost = rows.reduce((sum, r) => sum + (r.commission_amount ?? 0), 0);
    const employeeCost = (employeesRes.data ?? []).reduce((sum: number, e: any) => sum + (e.salary ?? 0), 0);
    const totalExpenses = partnerCost + employeeCost;
    const unassigned = rows.filter((r) => !r.partner_id).length;


    let slabs: (Slab & { id: string })[] = [];
    if (brand) {
      const { data: s } = await (context.supabase as any)
        .from("brand_slabs")
        .select("*")
        .eq("brand_id", brand.id)
        .order("min_count", { ascending: true });
      slabs = (s ?? []) as (Slab & { id: string })[];
    }

    const { total: brandRevenue, breakdown } = computeSlabAmount(totalActivations, slabs);
    const effectiveRate = totalActivations > 0 ? brandRevenue / totalActivations : 0;

    // Per-partner contribution to the agency
    const byPartner = new Map<string, { count: number; cost: number }>();
    for (const r of rows) {
      if (!r.partner_id) continue;
      const e = byPartner.get(r.partner_id) ?? { count: 0, cost: 0 };
      e.count += 1;
      e.cost += r.commission_amount ?? 0;
      byPartner.set(r.partner_id, e);
    }
    const contributions = Array.from(byPartner.entries())
      .map(([id, v]) => {
        const revenue = v.count * effectiveRate;
        return {
          partner_id: id,
          name: (partnerMap.get(id)?.name as string) ?? "Unknown",
          role: (partnerMap.get(id)?.role as string) ?? "",
          store_id: (partnerMap.get(id)?.store_id as string | null) ?? null,
          count: v.count,
          partner_cost: v.cost,
          brand_revenue: revenue,
          margin: revenue - v.cost,
        };
      })
      .sort((a, b) => b.margin - a.margin);

    let invoice: any = null;
    if (brand) {
      const { data: inv } = await (context.supabase as any)
        .from("brand_invoices")
        .select("*")
        .eq("brand_id", brand.id)
        .eq("month", month)
        .maybeSingle();
      invoice = inv ?? null;
    }

    return {
      month,
      brands,
      brand: brand ?? null,
      slabs,
      breakdown,
      total_activations: totalActivations,
      unassigned_activations: unassigned,
      brand_revenue: brandRevenue,
      partner_cost: partnerCost,
      total_expenses: totalExpenses,
      employee_cost: employeeCost,
      margin: brandRevenue - totalExpenses,

      effective_rate: effectiveRate,
      contributions,
      invoice,
    };
  });

/** Freeze the month's numbers into a receivable the agency can chase. */
export const saveBrandInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { brand_id: string; month: string }) => input)
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const month = monthStart(data.month);

    const [{ data: rows }, { data: slabs }] = await Promise.all([
      context.supabase
        .from("extractions")
        .select("commission_amount")
        .eq("status", "success")
        .eq("is_duplicate", false)
        .eq("commission_month", month),
      (context.supabase as any).from("brand_slabs").select("*").eq("brand_id", data.brand_id),
    ]);

    const list = (rows ?? []) as any[];
    const count = list.length;
    const partnerCost = list.reduce((s, r) => s + (r.commission_amount ?? 0), 0);
    const { total } = computeSlabAmount(count, (slabs ?? []) as Slab[]);

    const { error } = await (context.supabase as any).from("brand_invoices").upsert(
      {
        workspace_id: wsId,
        brand_id: data.brand_id,
        month,
        activations_count: count,
        amount_pkr: total,
        partner_cost_pkr: partnerCost,
        margin_pkr: total - partnerCost,
      },
      { onConflict: "brand_id,month" },
    );
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const markBrandInvoiceReceived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; received: boolean; payment_reference?: string | null; notes?: string | null }) => input)
  .handler(async ({ data, context }) => {
    await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const { error } = await (context.supabase as any)
      .from("brand_invoices")
      .update({
        status: data.received ? "received" : "pending",
        received_at: data.received ? new Date().toISOString() : null,
        received_by: data.received ? context.userId : null,
        payment_reference: data.payment_reference ?? null,
        notes: data.notes ?? null,
      })
      .eq("id", data.id);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
