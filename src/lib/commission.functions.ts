// Server functions for commission slabs, unassigned activations, and summary tiles.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { assertActiveWorkspaceRole } from "./authz.server";
import { requireActiveWorkspaceId } from "./workspace-helpers";
import { findSlabConflict, type SlabLike } from "./slab-validation";
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
  /** Activation type this rate applies to. Null = every activation type. */
  activation_type_id?: string | null;
  /** Inclusive first day this rate applies (YYYY-MM-DD). Null = always. */
  effective_from?: string | null;
  /** Inclusive last day this rate applies (YYYY-MM-DD). Null = open-ended. */
  effective_to?: string | null;
};

export type ActivationType = {
  id: string;
  workspace_id: string;
  name: string;
  code: string | null;
  active: boolean;
  sort_order: number;
};

export const listActivationTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
    const { data, error } = await context.supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("activation_types" as any)
      .select("*")
      .eq("workspace_id", wsId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    // The table arrives with a migration; treat "not there yet" as "none configured".
    if (error) {
      if (/activation_types/i.test(error.message)) return [] as ActivationType[];
      throw new Error(error.message);
    }
    return (data ?? []) as unknown as ActivationType[];
  });

export const upsertActivationType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string; name: string; code?: string | null; active?: boolean; sort_order?: number }) => input)
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const name = data.name.trim();
    if (!name) throw new Error("Give the activation type a name.");
    const payload = {
      name,
      code: data.code?.trim() || null,
      active: data.active ?? true,
      sort_order: data.sort_order ?? 0,
      workspace_id: wsId,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = context.supabase.from("activation_types" as any);
    const { error } = data.id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? await table.update(payload).eq("id", data.id).eq("workspace_id", wsId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : await table.insert(payload);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteActivationType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const { error } = await context.supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("activation_types" as any)
      .delete()
      .eq("workspace_id", wsId)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const listSlabs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Role-default slabs only (partner_id is NULL)
    const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("commission_slabs")
      .select("*")
      .eq("workspace_id", wsId)
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
    const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("commission_slabs")
      .select("*")
      .eq("workspace_id", wsId)
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

    // The editor validates too, but this is the rule that actually holds.
    {
      let siblings = context.supabase
        .from("commission_slabs")
        .select("id, min_count, max_count, rate_pkr, partner_id, activation_type_id, effective_from, effective_to")
        .eq("role", data.role);
      siblings = data.partner_id
        ? siblings.eq("partner_id", data.partner_id)
        : siblings.is("partner_id", null);
      const { data: rows } = await siblings;
      const conflict = findSlabConflict(data, (rows ?? []) as unknown as SlabLike[]);
      if (conflict) throw new Error(conflict);
    }

    if (data.id) {
      const { id, ...rest } = data;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await context.supabase.from("commission_slabs").update(rest).eq("id", id);
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
      const { error } = await context.supabase.from("commission_slabs").insert({ ...data, workspace_id });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteSlab = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const wsIdDel = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const { error } = await context.supabase.from("commission_slabs").delete().eq("workspace_id", wsIdDel).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listUnassigned = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const wsIdUnassigned = await requireActiveWorkspaceId(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("extractions")
      .select("id, customer_name, phone_number, employee_name, reference, branch_name, store_id, activation_date, created_at, batch_id")
      .eq("workspace_id", wsIdUnassigned)
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
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const { data: partnerOwner } = await context.supabase
      .from("partners").select("id").eq("workspace_id", wsId).eq("id", data.partner_id).maybeSingle();
    if (!partnerOwner) throw new Error("Partner not found in this workspace");
    const { data: ex } = await context.supabase
      .from("extractions")
      .select("activation_date_parsed")
      .eq("workspace_id", wsId)
      .eq("id", data.extraction_id)
      .single();
    const parsed = (ex as { activation_date_parsed?: string | null } | null)?.activation_date_parsed;
    const month = parsed ? parsed : new Date().toISOString().slice(0, 10);
    const monthStart = month.slice(0, 8) + "01";

    const { error } = await context.supabase
      .from("extractions")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ partner_id: data.partner_id, commission_month: monthStart })
      .eq("workspace_id", wsId)
      .eq("id", data.extraction_id);
    if (error) throw new Error(error.message);

    if (data.add_match_key && data.add_match_key.trim()) {
      const { data: p } = await context.supabase.from("partners").select("match_keys").eq("workspace_id", wsId).eq("id", data.partner_id).single();
      const keys = new Set<string>(((p?.match_keys as string[] | null) ?? []).map((k) => k.trim()).filter(Boolean));
      keys.add(data.add_match_key.trim());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await context.supabase.from("partners").update({ match_keys: Array.from(keys) }).eq("workspace_id", wsId).eq("id", data.partner_id);
    }
    return { ok: true };
  });

export const getCommissionSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month?: string }) => input)
  .handler(async ({ data, context }) => {
    const monthStart = (data.month ?? new Date().toISOString().slice(0, 8) + "01").slice(0, 8) + "01";
    const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);

    const [{ data: rows }, { count: unassigned }, { data: partners }] = await Promise.all([
      context.supabase
        .from("extractions")
        .select("partner_id, commission_amount")
        .eq("workspace_id", wsId)
        .eq("status", "success")
        .eq("is_duplicate", false)
        .eq("commission_month", monthStart)
        .not("partner_id", "is", null),
      context.supabase
        .from("extractions")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", wsId)
        .eq("status", "success")
        .eq("is_duplicate", false)
        .is("partner_id", null),
      context.supabase.from("partners").select("id, name, role, store_id").eq("workspace_id", wsId),
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
