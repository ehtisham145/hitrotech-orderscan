// Dashboard KPI tiles: MTD vs last month, projected month-end, near-slab nudges.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import type { PartnerRole } from "./partners.functions";
import { slabsEffectiveOn } from "./brand-slabs";
import { requireActiveWorkspaceId } from "./workspace-helpers";
import type { ServerContext } from "./server-context";

// Each handler is a plain `<name>Core(data, context)` function with a one-line
// createServerFn wrapper under it — see src/lib/server-context.ts for why.

type Slab = { role: PartnerRole; min_count: number; max_count: number | null; rate_pkr: number; active: boolean };

export async function getDashboardKpisCore(context: ServerContext) {
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
  const dayOfMonth = now.getDate();
  // days in current month
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);

  const [thisRes, lastRes, partnersRes, slabsRes, employeesRes] = await Promise.all([
    context.supabase
      .from("extractions")
      .select("partner_id, commission_amount, store_id, activation_date_parsed")
      .eq("workspace_id", wsId)
      .eq("status", "success")
      .eq("is_duplicate", false)
      .eq("commission_month", thisMonthStart),
    context.supabase
      .from("extractions")
      .select("partner_id, commission_amount, activation_date_parsed")
      .eq("workspace_id", wsId)
      .eq("status", "success")
      .eq("is_duplicate", false)
      .eq("commission_month", lastMonthStart),
    context.supabase.from("partners").select("id, name, role, store_id, active").eq("workspace_id", wsId),
    context.supabase.from("commission_slabs").select("role, min_count, max_count, rate_pkr, active, effective_from, effective_to").eq("workspace_id", wsId).eq("active", true),
    context.supabase.from("employees").select("salary").eq("workspace_id", wsId),
  ]);
  // BUG FIX: none of these five errors was checked — every number on this
  // dashboard (MTD commission, month-over-month %, projected month-end,
  // employee cost) is money-derived, and a failed query here silently
  // produced wrong or zeroed figures instead of failing.
  if (thisRes.error) throw new Error(thisRes.error.message);
  if (lastRes.error) throw new Error(lastRes.error.message);
  if (partnersRes.error) throw new Error(partnersRes.error.message);
  if (slabsRes.error) throw new Error(slabsRes.error.message);
  if (employeesRes.error) throw new Error(employeesRes.error.message);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const thisRows = (thisRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastRows = (lastRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const partners = (partnersRes.data ?? []) as any[];
  const slabs = slabsEffectiveOn(((slabsRes.data ?? []) as Slab[]), thisMonthStart);

  // Employee fixed costs (salaries)
  const employeeCost = (employeesRes.data ?? []).reduce((sum: number, e: any) => sum + (e.salary ?? 0), 0);

  // MTD numbers
  const mtdCount = thisRows.length;
  const mtdAmount = thisRows.reduce((a, r) => a + (r.commission_amount ?? 0), 0);
  const mtdTotalExpenses = mtdAmount + employeeCost;

  // Last month MTD (same day-of-month cutoff) for fair comparison
  const lastCutoff = new Date(now.getFullYear(), now.getMonth() - 1, dayOfMonth);
  const lastMtd = lastRows.filter((r) => {
    if (!r.activation_date_parsed) return false;
    return new Date(r.activation_date_parsed) <= lastCutoff;
  });
  const lastMtdCount = lastMtd.length;
  const lastMtdAmount = lastMtd.reduce((a, r) => a + (r.commission_amount ?? 0), 0);
  const lastFullCount = lastRows.length;
  const lastFullAmount = lastRows.reduce((a, r) => a + (r.commission_amount ?? 0), 0);

  const countMoM = lastMtdCount > 0 ? Math.round(((mtdCount - lastMtdCount) / lastMtdCount) * 100) : null;
  const amountMoM = lastMtdAmount > 0 ? Math.round(((mtdAmount - lastMtdAmount) / lastMtdAmount) * 100) : null;

  // Projected month-end (linear extrapolation from today's pace)
  const projectedCount = Math.round((mtdCount / Math.max(1, dayOfMonth)) * daysInMonth);
  const projectedAmount = Math.round((mtdAmount / Math.max(1, dayOfMonth)) * daysInMonth);

  // Per-partner counts this month
  const byPartner = new Map<string, number>();
  for (const r of thisRows) {
    if (!r.partner_id) continue;
    byPartner.set(r.partner_id, (byPartner.get(r.partner_id) ?? 0) + 1);
  }

  // Top stores this month
  const byStore = new Map<string, number>();
  const byStoreAmt = new Map<string, number>();
  for (const r of thisRows) {
    const id = r.store_id || "—";
    byStore.set(id, (byStore.get(id) ?? 0) + 1);
    byStoreAmt.set(id, (byStoreAmt.get(id) ?? 0) + (r.commission_amount ?? 0));
  }
  const topStores = Array.from(byStore.entries())
    .map(([store_id, count]) => ({ store_id, count, amount: byStoreAmt.get(store_id) ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // Top partners this month
  const topPartners = Array.from(byPartner.entries())
    .map(([partner_id, count]) => {
      const p = partners.find((x) => x.id === partner_id);
      return { partner_id, count, name: p?.name ?? "—", role: p?.role as PartnerRole };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // Near-slab nudges: partners within 3 activations of next slab
  const slabsByRole = new Map<PartnerRole, Slab[]>();
  for (const s of slabs) {
    const arr = slabsByRole.get(s.role) ?? [];
    arr.push(s);
    slabsByRole.set(s.role, arr);
  }
  for (const arr of slabsByRole.values()) arr.sort((a, b) => a.min_count - b.min_count);

  const nearSlab: Array<{
    partner_id: string;
    name: string;
    role: PartnerRole;
    count: number;
    to_go: number;
    next_at: number;
    current_rate: number;
    next_rate: number;
    uplift: number;
  }> = [];
  for (const p of partners) {
    if (!p.active) continue;
    const count = byPartner.get(p.id) ?? 0;
    if (count === 0) continue;
    const arr = slabsByRole.get(p.role as PartnerRole) ?? [];
    const current = [...arr].reverse().find((s) => count >= s.min_count && (s.max_count === null || count <= s.max_count));
    const next = arr.find((s) => s.min_count > count);
    if (!next || !current) continue;
    const to_go = next.min_count - count;
    if (to_go > 3 || to_go <= 0) continue;
    nearSlab.push({
      partner_id: p.id,
      name: p.name,
      role: p.role as PartnerRole,
      count,
      to_go,
      next_at: next.min_count,
      current_rate: current.rate_pkr,
      next_rate: next.rate_pkr,
      uplift: (next.rate_pkr - current.rate_pkr) * next.min_count,
    });
  }
  nearSlab.sort((a, b) => a.to_go - b.to_go || b.uplift - a.uplift);

  return {
    month: thisMonthStart,
    day_of_month: dayOfMonth,
    days_in_month: daysInMonth,
    mtd: { count: mtdCount, amount: mtdAmount, total_expenses: mtdTotalExpenses, employee_cost: employeeCost },
    last_mtd: { count: lastMtdCount, amount: lastMtdAmount },
    last_full: { count: lastFullCount, amount: lastFullAmount },
    mom: { count_pct: countMoM, amount_pct: amountMoM },
    projected: { count: projectedCount, amount: projectedAmount },

    top_stores: topStores,
    top_partners: topPartners,
    near_slab: nearSlab.slice(0, 6),
  };
}

export const getDashboardKpis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => getDashboardKpisCore(context));
