// Shared month-close engine. Server-only: used by the server function and the cron hook.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computeSlabAmount, type Slab } from "./brand-slabs";

export function monthStartOf(input?: string) {
  return ((input ?? new Date().toISOString().slice(0, 8) + "01").slice(0, 8) + "01") as string;
}

export function previousMonthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
}

export type CloseResult = {
  month: string;
  workspace_id: string;
  activations: number;
  partner_cost: number;
  brand_revenue: number;
  margin: number;
  payouts_created: number;
  payouts_updated: number;
  payouts_skipped: number;
};

/**
 * Freeze a month for one workspace:
 *  - snapshot every partner's activations into partner_payouts
 *  - price the agency total with the brand slabs into brand_invoices
 *  - write a month_closes audit row and lock the month
 */
export async function runMonthClose(
  supabase: any,
  workspaceId: string,
  monthInput: string,
  opts: { closedBy?: string | null; automatic?: boolean; lock?: boolean } = {},
): Promise<CloseResult> {
  const month = monthStartOf(monthInput);

  const { data: exts } = await supabase
    .from("extractions")
    .select("partner_id, commission_amount")
    .eq("workspace_id", workspaceId)
    .eq("status", "success")
    .eq("is_duplicate", false)
    .eq("commission_month", month);

  const rows = (exts ?? []) as Array<{ partner_id: string | null; commission_amount: number | null }>;
  const activations = rows.length;
  const partnerCost = rows.reduce((s, r) => s + (r.commission_amount ?? 0), 0);

  // ---- Partner payout snapshots ----
  const stats = new Map<string, { count: number; amount: number }>();
  for (const r of rows) {
    if (!r.partner_id) continue;
    const s = stats.get(r.partner_id) ?? { count: 0, amount: 0 };
    s.count += 1;
    s.amount += r.commission_amount ?? 0;
    stats.set(r.partner_id, s);
  }

  const { data: existing } = await supabase
    .from("partner_payouts")
    .select("partner_id, status")
    .eq("workspace_id", workspaceId)
    .eq("month", month);
  const existingMap = new Map<string, string>(
    ((existing ?? []) as Array<{ partner_id: string; status: string }>).map((e) => [e.partner_id, e.status]),
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  for (const [partner_id, s] of stats) {
    const prev = existingMap.get(partner_id);
    if (prev === "paid") {
      skipped += 1;
      continue;
    }
    const { error } = await supabase.from("partner_payouts").upsert(
      {
        partner_id,
        workspace_id: workspaceId,
        month,
        activations_count: s.count,
        rate_pkr: s.count > 0 ? Math.round(s.amount / s.count) : 0,
        amount_pkr: s.amount,
        status: "pending",
        snapshot_count: s.count,
        snapshot_amount: s.amount,
        snapshot_at: now,
      },
      { onConflict: "partner_id,month" },
    );
    if (!error) {
      if (prev) updated += 1;
      else created += 1;
    }
  }

  // ---- Brand invoice ----
  const { data: brands } = await supabase
    .from("brands")
    .select("id, active")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  const brandList = (brands ?? []) as Array<{ id: string; active: boolean }>;
  const brand = brandList.find((b) => b.active) ?? brandList[0] ?? null;

  let brandRevenue = 0;
  if (brand) {
    const { data: slabs } = await supabase.from("brand_slabs").select("*").eq("brand_id", brand.id);
    brandRevenue = computeSlabAmount(activations, (slabs ?? []) as Slab[]).total;
    await supabase.from("brand_invoices").upsert(
      {
        workspace_id: workspaceId,
        brand_id: brand.id,
        month,
        activations_count: activations,
        amount_pkr: brandRevenue,
        partner_cost_pkr: partnerCost,
        margin_pkr: brandRevenue - partnerCost,
      },
      { onConflict: "brand_id,month" },
    );
  }

  // ---- Close record ----
  await supabase.from("month_closes").upsert(
    {
      workspace_id: workspaceId,
      month,
      status: "closed",
      activations_count: activations,
      partner_cost_pkr: partnerCost,
      brand_revenue_pkr: brandRevenue,
      margin_pkr: brandRevenue - partnerCost,
      payouts_created: created + updated,
      closed_by: opts.closedBy ?? null,
      closed_automatically: opts.automatic ?? false,
    },
    { onConflict: "workspace_id,month" },
  );

  if (opts.lock !== false) {
    await supabase.from("month_locks").upsert(
      { workspace_id: workspaceId, month, locked_by: opts.closedBy ?? null, notes: opts.automatic ? "Auto month-close" : "Month close" },
      { onConflict: "workspace_id,month" },
    );
  }

  return {
    month,
    workspace_id: workspaceId,
    activations,
    partner_cost: partnerCost,
    brand_revenue: brandRevenue,
    margin: brandRevenue - partnerCost,
    payouts_created: created,
    payouts_updated: updated,
    payouts_skipped: skipped,
  };
}
