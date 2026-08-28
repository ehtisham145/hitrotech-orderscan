// Partner-facing statement and performance history.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import type { PartnerRole } from "./partners.functions";
import { slabsEffectiveOn } from "./brand-slabs";
import { requireActiveWorkspaceId } from "./workspace-helpers";

function monthStart(input?: string) {
  const s = (input ?? new Date().toISOString().slice(0, 8) + "01").slice(0, 8) + "01";
  return s;
}

function addMonths(date: string, delta: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + delta);
  return d.toISOString().slice(0, 10);
}

export const getPartnerStatement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { partner_id: string; month?: string }) => input)
  .handler(async ({ data, context }) => {
    const month = monthStart(data.month);
    const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);

    const [partnerRes, actRes, payoutRes, slabsRes] = await Promise.all([
      context.supabase.from("partners").select("*").eq("workspace_id", wsId).eq("id", data.partner_id).maybeSingle(),
      context.supabase
        .from("extractions")
        .select("id, phone_number, order_number, customer_name, activation_date, activation_date_parsed, store_id, package_name, commission_amount, is_duplicate, status")
        .eq("workspace_id", wsId)
        .eq("partner_id", data.partner_id)
        .eq("commission_month", month)
        .eq("status", "success")
        .eq("is_duplicate", false)
        .order("activation_date_parsed", { ascending: true, nullsFirst: false }),
      context.supabase
        .from("partner_payouts")
        .select("*")
        .eq("workspace_id", wsId)
        .eq("partner_id", data.partner_id)
        .eq("month", month)
        .maybeSingle(),
      context.supabase.from("commission_slabs").select("role, min_count, max_count, rate_pkr, active, effective_from, effective_to").eq("workspace_id", wsId).eq("active", true),
    ]);

    const partner = partnerRes.data;
    if (!partner) throw new Error("Partner not found");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activations = (actRes.data ?? []) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const slabs = slabsEffectiveOn(
      ((slabsRes.data ?? []) as any[]) as Array<{ role: PartnerRole; min_count: number; max_count: number | null; rate_pkr: number; effective_from?: string | null; effective_to?: string | null }>,
      month,
    );

    const count = activations.length;
    const forRole = slabs.filter((s) => s.role === partner.role).sort((a, b) => a.min_count - b.min_count);
    const current = [...forRole].reverse().find((s) => count >= s.min_count && (s.max_count === null || count <= s.max_count));
    const next = forRole.find((s) => s.min_count > count);
    const rate = current?.rate_pkr ?? 0;
    const amount = count * rate;

    return {
      month,
      partner,
      activations,
      slab: {
        current_rate: rate,
        current_min: current?.min_count ?? 0,
        current_max: current?.max_count ?? null,
        next_rate: next?.rate_pkr ?? null,
        next_at: next?.min_count ?? null,
        to_go: next ? Math.max(0, next.min_count - count) : null,
      },
      totals: { count, rate, amount },
      payout: payoutRes.data ?? null,
    };
  });

export const getPartnerHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { partner_id: string; months?: number }) => input)
  .handler(async ({ data, context }) => {
    const months = Math.max(1, Math.min(24, data.months ?? 6));
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const startMonth = addMonths(currentMonth, -(months - 1));
    const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);

    const [partnerRes, actRes, payoutRes] = await Promise.all([
      context.supabase.from("partners").select("*").eq("workspace_id", wsId).eq("id", data.partner_id).maybeSingle(),
      context.supabase
        .from("extractions")
        .select("commission_month, commission_amount, activation_date_parsed")
        .eq("workspace_id", wsId)
        .eq("partner_id", data.partner_id)
        .eq("status", "success")
        .eq("is_duplicate", false)
        .gte("commission_month", startMonth),
      context.supabase
        .from("partner_payouts")
        .select("month, status, amount_pkr, activations_count, paid_at, payment_reference")
        .eq("workspace_id", wsId)
        .eq("partner_id", data.partner_id)
        .gte("month", startMonth),
    ]);

    const partner = partnerRes.data;
    if (!partner) throw new Error("Partner not found");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const acts = (actRes.data ?? []) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payouts = (payoutRes.data ?? []) as any[];

    const byMonth = new Map<string, { count: number; commission: number }>();
    const daySet = new Map<string, Set<string>>(); // month -> set of days
    for (const r of acts) {
      const m = r.commission_month;
      if (!m) continue;
      const s = byMonth.get(m) ?? { count: 0, commission: 0 };
      s.count += 1;
      s.commission += r.commission_amount ?? 0;
      byMonth.set(m, s);
      if (r.activation_date_parsed) {
        const set = daySet.get(m) ?? new Set<string>();
        set.add(r.activation_date_parsed);
        daySet.set(m, set);
      }
    }
    const payoutByMonth = new Map<string, typeof payouts[number]>();
    for (const p of payouts) payoutByMonth.set(p.month, p);

    const series: Array<{
      month: string;
      label: string;
      count: number;
      commission: number;
      days_worked: number;
      avg_per_day: number;
      status: string;
      paid_at: string | null;
    }> = [];
    for (let i = 0; i < months; i++) {
      const m = addMonths(currentMonth, -(months - 1 - i));
      const s = byMonth.get(m) ?? { count: 0, commission: 0 };
      const days = daySet.get(m)?.size ?? 0;
      const p = payoutByMonth.get(m);
      series.push({
        month: m,
        label: new Date(m).toLocaleString("en", { month: "short", year: "2-digit" }),
        count: s.count,
        commission: s.commission,
        days_worked: days,
        avg_per_day: days > 0 ? Math.round((s.count / days) * 10) / 10 : 0,
        status: p?.status ?? (s.count > 0 ? "pending" : "none"),
        paid_at: p?.paid_at ?? null,
      });
    }

    const totalCount = series.reduce((a, r) => a + r.count, 0);
    const totalCommission = series.reduce((a, r) => a + r.commission, 0);
    const best = series.reduce<typeof series[number] | null>((acc, r) => (!acc || r.count > acc.count ? r : acc), null);
    const totalDays = series.reduce((a, r) => a + r.days_worked, 0);

    return {
      partner,
      series,
      totals: {
        months,
        count: totalCount,
        commission: totalCommission,
        avg_per_month: months > 0 ? Math.round(totalCount / months) : 0,
        avg_per_day: totalDays > 0 ? Math.round((totalCount / totalDays) * 10) / 10 : 0,
        best_month: best?.label ?? null,
        best_month_count: best?.count ?? 0,
      },
    };
  });
