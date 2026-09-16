// Leaderboard + store performance analytics.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import type { PartnerRole } from "./partners.functions";
import { slabsEffectiveOn } from "./brand-slabs";
import { requireActiveWorkspaceId } from "./workspace-helpers";
import type { ServerContext } from "./server-context";

// Each handler is a plain `<name>Core(data, context)` function with a one-line
// createServerFn wrapper under it — see src/lib/server-context.ts for why.

// BUG FIX: a fourth copy of the same date bug found across the codebase this
// round (reliability.functions.ts, month-close.server.ts, statements.
// functions.ts) — here inlined (and duplicated within this very file, once
// per endpoint) as `(month ?? ...).slice(0, 8) + "01"`. Only valid for a
// 10-char "YYYY-MM-DD" input; a 7-char "YYYY-MM" input (what
// <input type="month"> sends) comes out as "2026-0901" — no dash, not a
// parseable date. Pulled into one shared helper with the corrected formula
// so both endpoints (and any future one added here) share a single fix.
function monthStart(input?: string) {
  const base = input ?? new Date().toISOString().slice(0, 10);
  return base.slice(0, 7) + "-01";
}

type Slab = { role: PartnerRole; min_count: number; max_count: number | null; rate_pkr: number; active: boolean };

function nextSlab(slabs: Slab[], role: PartnerRole, count: number) {
  const forRole = slabs
    .filter((s) => s.role === role && s.active)
    .sort((a, b) => a.min_count - b.min_count);
  const current = [...forRole].reverse().find((s) => count >= s.min_count && (s.max_count === null || count <= s.max_count));
  const next = forRole.find((s) => s.min_count > count);
  return {
    current_rate: current?.rate_pkr ?? 0,
    next_rate: next?.rate_pkr ?? null,
    next_at: next?.min_count ?? null,
    to_go: next ? Math.max(0, next.min_count - count) : null,
  };
}

export async function getLeaderboardCore(
  data: { month?: string; role?: PartnerRole | "all"; store_id?: string | "all" },
  context: ServerContext,
) {
  const month = monthStart(data.month);
  const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);

  const [partnersRes, slabsRes, rowsRes] = await Promise.all([
    context.supabase.from("partners").select("id, name, role, store_id, active, phone, city").eq("workspace_id", wsId),
    context.supabase.from("commission_slabs").select("role, min_count, max_count, rate_pkr, active, effective_from, effective_to").eq("workspace_id", wsId),
    context.supabase
      .from("extractions")
      .select("partner_id, commission_amount")
      .eq("workspace_id", wsId)
      .eq("status", "success")
      .eq("is_duplicate", false)
      .eq("commission_month", month)
      .not("partner_id", "is", null),
  ]);
  // BUG FIX: none of these three errors was checked — this is the
  // partner-commission leaderboard, real money, and a failed query silently
  // produced wrong or empty figures indistinguishable from a quiet month.
  if (partnersRes.error) throw new Error(partnersRes.error.message);
  if (slabsRes.error) throw new Error(slabsRes.error.message);
  if (rowsRes.error) throw new Error(rowsRes.error.message);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const partners = (partnersRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slabs = slabsEffectiveOn(((slabsRes.data ?? []) as any[]) as Slab[], month);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (rowsRes.data ?? []) as any[];

  const byPartner = new Map<string, { count: number; commission: number }>();
  for (const r of rows) {
    const entry = byPartner.get(r.partner_id) ?? { count: 0, commission: 0 };
    entry.count += 1;
    entry.commission += r.commission_amount ?? 0;
    byPartner.set(r.partner_id, entry);
  }

  const list = partners
    .filter((p) => (data.role === "all" || !data.role ? true : p.role === data.role))
    .filter((p) => (data.store_id === "all" || !data.store_id ? true : p.store_id === data.store_id))
    .map((p) => {
      const stat = byPartner.get(p.id) ?? { count: 0, commission: 0 };
      const slab = nextSlab(slabs, p.role, stat.count);
      return {
        id: p.id,
        name: p.name,
        role: p.role as PartnerRole,
        store_id: p.store_id as string | null,
        phone: p.phone as string | null,
        city: p.city as string | null,
        active: p.active as boolean,
        count: stat.count,
        commission: stat.commission,
        ...slab,
      };
    })
    .sort((a, b) => b.commission - a.commission || b.count - a.count);

  return { month, rows: list };
}

export const getLeaderboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month?: string; role?: PartnerRole | "all"; store_id?: string | "all" }) => input)
  .handler(({ data, context }) => getLeaderboardCore(data, context));

export async function getStorePerformanceCore(data: { month?: string }, context: ServerContext) {
  const month = monthStart(data.month);
  const monthEndDate = new Date(month);
  monthEndDate.setMonth(monthEndDate.getMonth() + 1);
  const monthEnd = monthEndDate.toISOString().slice(0, 10);

  const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
  const [allRes, commissionRes, partnersRes, storesRes] = await Promise.all([
    // Every activation this month by store (whether linked or not)
    context.supabase
      .from("extractions")
      .select("store_id, status, is_duplicate, needs_review, partner_id")
      .eq("workspace_id", wsId)
      .gte("created_at", month)
      .lt("created_at", monthEnd),
    // Linked ones only for commission sum
    context.supabase
      .from("extractions")
      .select("store_id, commission_amount, partner_id")
      .eq("workspace_id", wsId)
      .eq("status", "success")
      .eq("is_duplicate", false)
      .eq("commission_month", month)
      .not("partner_id", "is", null),
    context.supabase.from("partners").select("id, store_id, active").eq("workspace_id", wsId),
    context.supabase.from("stores").select("code").eq("workspace_id", wsId),
  ]);
  // BUG FIX: none of these four errors was checked, same reasoning as
  // getLeaderboardCore above.
  if (allRes.error) throw new Error(allRes.error.message);
  if (commissionRes.error) throw new Error(commissionRes.error.message);
  if (partnersRes.error) throw new Error(partnersRes.error.message);
  if (storesRes.error) throw new Error(storesRes.error.message);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = (allRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commission = (commissionRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const partners = (partnersRes.data ?? []) as any[];

  type Bucket = {
    store_id: string;
    total: number;
    success: number;
    duplicates: number;
    failed: number;
    needs_review: number;
    unassigned: number;
    commission: number;
    partners_active: number;
    partners_total: number;
  };
  const stores = new Map<string, Bucket>();
  const empty = (id: string): Bucket => ({
    store_id: id,
    total: 0, success: 0, duplicates: 0, failed: 0, needs_review: 0, unassigned: 0, commission: 0, partners_active: 0, partners_total: 0,
  });

  for (const r of all) {
    const id = r.store_id || "—";
    const b = stores.get(id) ?? empty(id);
    b.total += 1;
    if (r.is_duplicate) b.duplicates += 1;
    else if (r.status === "success") {
      b.success += 1;
      if (r.needs_review) b.needs_review += 1;
      if (!r.partner_id) b.unassigned += 1;
    } else if (r.status === "failed") b.failed += 1;
    stores.set(id, b);
  }
  for (const r of commission) {
    const id = r.store_id || "—";
    const b = stores.get(id) ?? empty(id);
    b.commission += r.commission_amount ?? 0;
    stores.set(id, b);
  }
  for (const p of partners) {
    const id = p.store_id || "—";
    const b = stores.get(id) ?? empty(id);
    b.partners_total += 1;
    if (p.active) b.partners_active += 1;
    stores.set(id, b);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const managedCodes = ((storesRes.data ?? []) as any[]).map((s) => s.code as string);
  // Only include Store IDs the workspace has explicitly added.
  for (const code of managedCodes) {
    if (!stores.has(code)) stores.set(code, empty(code));
  }
  const list = Array.from(stores.values())
    .filter((b) => managedCodes.includes(b.store_id))
    .sort((a, b) => b.commission - a.commission || b.success - a.success);
  return { month, stores: list };
}

export const getStorePerformance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month?: string }) => input)
  .handler(({ data, context }) => getStorePerformanceCore(data, context));
