// Server functions for commission slabs, unassigned activations, and summary tiles.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { assertActiveWorkspaceRole } from "./authz.server";
import type { PartnerRole } from "./partners.functions";

const WRITE_ROLES = ["owner", "admin", "manager"] as const;

export type SlabInput = {
  id?: string;
  role: PartnerRole;
  min_count: number;
  max_count: number | null;
  rate_pkr: number;
  active: boolean;
  partner_id?: string | null;
  /** Inclusive first day this rate applies (YYYY-MM-DD). Null = always. */
  effective_from?: string | null;
  /** Inclusive last day this rate applies (YYYY-MM-DD). Null = open-ended. */
  effective_to?: string | null;
};

export const listSlabs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Role-default slabs only (partner_id is NULL)
    const { data, error } = await context.supabase
      .from("commission_slabs")
      .select("*")
      .is("partner_id", null)
      .order("role", { ascending: true })
      .order("min_count", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listPartnerSlabs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { partner_id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("commission_slabs")
      .select("*")
      .eq("partner_id", data.partner_id)
      .order("min_count", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });


export const upsertSlab = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SlabInput) => input)
  .handler(async ({ data, context }) => {
    await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    if (data.id) {
      const { id, ...rest } = data;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await context.supabase.from("commission_slabs").update(rest as any).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      // Resolve workspace_id (NOT NULL + required by RLS policy)
      let workspace_id: string | null = null;
      if (data.partner_id) {
        const { data: p, error: pe } = await context.supabase
          .from("partners")
          .select("workspace_id")
          .eq("id", data.partner_id)
          .single();
        if (pe) throw new Error(pe.message);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        workspace_id = (p as any)?.workspace_id ?? null;
      }
      if (!workspace_id) {
        const { data: prof } = await context.supabase
          .from("profiles")
          .select("active_workspace_id")
          .eq("id", context.userId)
          .single();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        workspace_id = (prof as any)?.active_workspace_id ?? null;
      }
      if (!workspace_id) throw new Error("No workspace context found for slab.");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await context.supabase.from("commission_slabs").insert({ ...data, workspace_id } as any);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteSlab = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const { error } = await context.supabase.from("commission_slabs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listUnassigned = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("extractions")
      .select("id, customer_name, phone_number, employee_name, reference, branch_name, store_id, activation_date, created_at, batch_id")
      .eq("status", "success")
      .eq("is_duplicate", false)
      .is("partner_id", null)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const assignExtractionToPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { extraction_id: string; partner_id: string; add_match_key?: string | null }) => input)
  .handler(async ({ data, context }) => {
    await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const { data: ex } = await context.supabase
      .from("extractions")
      .select("activation_date_parsed")
      .eq("id", data.extraction_id)
      .single();
    const parsed = (ex as { activation_date_parsed?: string | null } | null)?.activation_date_parsed;
    const month = parsed ? parsed : new Date().toISOString().slice(0, 10);
    const monthStart = month.slice(0, 8) + "01";

    const { error } = await context.supabase
      .from("extractions")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ partner_id: data.partner_id, commission_month: monthStart } as any)
      .eq("id", data.extraction_id);
    if (error) throw new Error(error.message);

    if (data.add_match_key && data.add_match_key.trim()) {
      const { data: p } = await context.supabase.from("partners").select("match_keys").eq("id", data.partner_id).single();
      const keys = new Set<string>(((p?.match_keys as string[] | null) ?? []).map((k) => k.trim()).filter(Boolean));
      keys.add(data.add_match_key.trim());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await context.supabase.from("partners").update({ match_keys: Array.from(keys) } as any).eq("id", data.partner_id);
    }
    return { ok: true };
  });

export const getCommissionSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month?: string }) => input)
  .handler(async ({ data, context }) => {
    const monthStart = (data.month ?? new Date().toISOString().slice(0, 8) + "01").slice(0, 8) + "01";

    const [{ data: rows }, { count: unassigned }, { data: partners }] = await Promise.all([
      context.supabase
        .from("extractions")
        .select("partner_id, commission_amount")
        .eq("status", "success")
        .eq("is_duplicate", false)
        .eq("commission_month", monthStart)
        .not("partner_id", "is", null),
      context.supabase
        .from("extractions")
        .select("id", { count: "exact", head: true })
        .eq("status", "success")
        .eq("is_duplicate", false)
        .is("partner_id", null),
      context.supabase.from("partners").select("id, name, role, store_id"),
    ]);

    const partnerMap = new Map<string, { name: string; role: string; store_id: string | null }>();
    (partners ?? []).forEach((p) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rr = p as any;
      partnerMap.set(rr.id, { name: rr.name, role: rr.role, store_id: rr.store_id });
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = (rows ?? []) as any[];
    const byPartner = new Map<string, { count: number; commission: number }>();
    let total = 0;
    for (const r of list) {
      const entry = byPartner.get(r.partner_id) ?? { count: 0, commission: 0 };
      entry.count += 1;
      entry.commission += r.commission_amount ?? 0;
      byPartner.set(r.partner_id, entry);
      total += r.commission_amount ?? 0;
    }

    const leaderboard = Array.from(byPartner.entries())
      .map(([id, v]) => ({ id, ...v, ...partnerMap.get(id) }))
      .sort((a, b) => b.commission - a.commission);

    return {
      month: monthStart,
      total_commission: total,
      total_activations: list.length,
      top_earner: leaderboard[0] ?? null,
      unassigned_count: unassigned ?? 0,
      leaderboard,
    };
  });
