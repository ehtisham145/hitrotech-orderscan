// Server functions for managing partners (retailers, franchisees, field workers).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { assertActiveWorkspaceRole } from "./authz.server";
import { requireActiveWorkspaceId } from "./workspace-helpers";
import { omitNulls } from "./db-payload";
import type { ServerContext } from "./server-context";

// Each handler is a plain `<name>Core(data, context)` function with a one-line
// createServerFn wrapper under it — see src/lib/server-context.ts for why.

const WRITE_ROLES = ["owner", "admin", "manager"] as const;

export type PartnerRole = "franchise_owner" | "retailer" | "franchise_as_retailer";

export async function listPartnersCore(context: ServerContext) {
  const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
  const { data, error } = await context.supabase
    .from("partners")
    .select("*")
    .eq("workspace_id", wsId)
    .order("active", { ascending: false })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export const listPartners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => listPartnersCore(context));

export async function getPartnerCore(data: { id: string }, context: ServerContext) {
  const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
  const { data: p, error } = await context.supabase.from("partners").select("*").eq("workspace_id", wsId).eq("id", data.id).maybeSingle();
  if (error) throw new Error(error.message);
  return p;
}

export const getPartner = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(({ data, context }) => getPartnerCore(data, context));

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

export async function createPartnerCore(data: PartnerInput, context: ServerContext) {
  const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);

  // Enforce plan partner limit (super admins are exempt).
  // BUG FIX: all three of these lookups previously discarded their `error`,
  // so a transient failure on any of them was indistinguishable from a real
  // answer — the ws lookup silently fell back to treating the workspace as
  // unset (free-tier limit), and the count check silently fell back to 0,
  // either of which could wrongly block or wrongly allow a partner create.
  const { data: isSuper, error: superErr } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (superErr) throw new Error(superErr.message);
  const { getPartnerLimit } = await import("./plans");
  const { effectivePlanTier } = await import("./plan-features");
  const { data: ws, error: wsErr } = await context.supabase
    .from("workspaces")
    .select("plan_tier, plan_expires_at")
    .eq("id", wsId)
    .maybeSingle();
  if (wsErr) throw new Error(wsErr.message);
  const wsPlan = ws as { plan_tier?: string; plan_expires_at?: string | null } | null;
  // Expired plans fall back to the free partner limit rather than keeping the
  // paid one the database still records.
  const limit = isSuper ? null : getPartnerLimit(effectivePlanTier(wsPlan?.plan_tier, wsPlan?.plan_expires_at));
  if (limit !== null) {
    const { count, error: countErr } = await context.supabase
      .from("partners")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", wsId);
    if (countErr) throw new Error(countErr.message);
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
}

export const createPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: PartnerInput) => input)
  .handler(({ data, context }) => createPartnerCore(data, context));

export async function updatePartnerCore(data: { id: string } & Partial<PartnerInput>, context: ServerContext) {
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
}

export const updatePartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string } & Partial<PartnerInput>) => input)
  .handler(({ data, context }) => updatePartnerCore(data, context));

export async function deletePartnerCore(data: { id: string }, context: ServerContext) {
  const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
  const { error } = await context.supabase.from("partners").delete().eq("workspace_id", wsId).eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export const deletePartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(({ data, context }) => deletePartnerCore(data, context));

// BUG FIX: the lookup of the partner's existing match_keys discarded its
// `error`. If that select failed for any reason (including a partner id
// that belongs to another workspace, since .single() then errors instead
// of returning a row), `p` stayed undefined and the code silently treated
// the partner as having zero match_keys — the update that followed then
// overwrote the row with *only* the one new key, discarding every key it
// already had. The error is checked now, so a failed lookup fails the
// whole call instead of quietly wiping data.
export async function addPartnerMatchKeyCore(data: { id: string; key: string }, context: ServerContext) {
  const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...WRITE_ROLES]);
  const { data: p, error: selectErr } = await context.supabase
    .from("partners")
    .select("match_keys")
    .eq("workspace_id", wsId)
    .eq("id", data.id)
    .single();
  if (selectErr) throw new Error(selectErr.message);
  const keys = new Set<string>(((p?.match_keys as string[] | null) ?? []).map((k) => k.trim()).filter(Boolean));
  if (data.key.trim()) keys.add(data.key.trim());
  const { error } = await context.supabase.from("partners").update({ match_keys: Array.from(keys) }).eq("workspace_id", wsId).eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export const addPartnerMatchKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; key: string }) => input)
  .handler(({ data, context }) => addPartnerMatchKeyCore(data, context));
