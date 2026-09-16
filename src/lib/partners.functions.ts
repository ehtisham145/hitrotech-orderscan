// Server functions for managing partners (retailers, franchisees, field workers).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { assertActiveWorkspaceRole } from "./authz.server";
import { requireActiveWorkspaceId } from "./workspace-helpers";
import { omitNulls } from "./db-payload";

const WRITE_ROLES = ["owner", "admin", "manager"] as const;

export type PartnerRole = "franchise_owner" | "retailer" | "franchise_as_retailer";

export const listPartners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("partners")
      .select("*")
      .eq("workspace_id", wsId)
      .order("active", { ascending: false })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getPartner = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
    const { data: p, error } = await context.supabase.from("partners").select("*").eq("workspace_id", wsId).eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    return p;
  });

export type PartnerInput = {
  name: string;
  phone?: string | null;
  cnic?: string | null;
  address?: string | null;
  city?: string | null;
  store_id?: string | null;
  role: PartnerRole;
  match_keys: string[];
  active: boolean;
  join_date?: string | null;
  notes?: string | null;
  invited_email?: string | null;
};

export const createPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: PartnerInput) => input)
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);

    // Enforce plan partner limit (super admins are exempt)
    const { data: isSuper } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
    const { getPartnerLimit } = await import("./plans");
    const { effectivePlanTier } = await import("./plan-features");
    const { data: ws } = await context.supabase
      .from("workspaces")
      .select("plan_tier, plan_expires_at")
      .eq("id", wsId)
      .maybeSingle();
    const wsPlan = ws as { plan_tier?: string; plan_expires_at?: string | null } | null;
    // Expired plans fall back to the free partner limit rather than keeping the
    // paid one the database still records.
    const limit = isSuper ? null : getPartnerLimit(effectivePlanTier(wsPlan?.plan_tier, wsPlan?.plan_expires_at));
    if (limit !== null) {
      const { count } = await context.supabase
        .from("partners")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", wsId);
      if ((count ?? 0) >= limit) {
        return {
          ok: false as const,
          error: `Your current plan allows only ${limit} partner${limit === 1 ? "" : "s"}. Upgrade to add more.`,
        };
      }
    }

    // join_date is NOT NULL with a default; the input type allows null for
    // "left blank", which the constraint rejects. See omitNulls.
    const payload = omitNulls({
      ...data,
      workspace_id: wsId,
      created_by: context.userId,
    }, ["join_date"]);
    const { data: row, error } = await context.supabase.from("partners").insert(payload).select("*").single();
    if (error) {
      if (error.code === "23505" || /partners_cnic_unique/i.test(error.message)) {
        return { ok: false as const, error: "A partner with this CNIC already exists." };
      }
      return { ok: false as const, error: error.message };
    }
    return { ok: true as const, row };
  });

export const updatePartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string } & Partial<PartnerInput>) => input)
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const { id, ...rest } = data;
    const { data: row, error } = await context.supabase
      .from("partners")
      .update(omitNulls(rest, ["join_date"]))
      .eq("workspace_id", wsId).eq("id", id).select("*").single();
    if (error) {
      if (error.code === "23505" || /partners_cnic_unique/i.test(error.message)) {
        return { ok: false as const, error: "A partner with this CNIC already exists." };
      }
      return { ok: false as const, error: error.message };
    }
    return { ok: true as const, row };
  });


export const deletePartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const { error } = await context.supabase.from("partners").delete().eq("workspace_id", wsId).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addPartnerMatchKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; key: string }) => input)
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
    const { data: p } = await context.supabase.from("partners").select("match_keys").eq("workspace_id", wsId).eq("id", data.id).single();
    const keys = new Set<string>(((p?.match_keys as string[] | null) ?? []).map((k) => k.trim()).filter(Boolean));
    if (data.key.trim()) keys.add(data.key.trim());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await context.supabase.from("partners").update({ match_keys: Array.from(keys) }).eq("workspace_id", wsId).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
