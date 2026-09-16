// Workspace-scoped store management.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { requireActiveWorkspaceId } from "./workspace-helpers";
import { assertActiveWorkspaceRole } from "./authz.server";

export const listStores = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("stores")
      .select("id, code, label, sort_order")
      .eq("workspace_id", wsId)
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string; label?: string | null }) => input)
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, ["owner", "admin"]);
    const code = data.code.trim().toUpperCase();
    if (!code) throw new Error("Store code is required");
    if (code.length > 32) throw new Error("Store code is too long");
    const label = data.label?.trim() || null;
    const { data: row, error } = await context.supabase
      .from("stores")
      .insert({ workspace_id: wsId, code, label })
      .select("id, code, label, sort_order")
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new Error(`Store "${code}" already exists in this workspace`);
      }
      throw new Error(error.message);
    }
    return row;
  });

export const updateStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; code: string; label?: string | null }) => input)
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, ["owner", "admin"]);
    // Same normalisation and limits as createStore — a code edited here has to
    // end up in exactly the shape a created one would, or the two paths drift.
    const code = data.code.trim().toUpperCase();
    if (!code) throw new Error("Store code is required");
    if (code.length > 32) throw new Error("Store code is too long");
    const label = data.label?.trim() || null;
    const { data: row, error } = await context.supabase
      .from("stores")
      .update({ code, label })
      .eq("workspace_id", wsId)
      .eq("id", data.id)
      .select("id, code, label, sort_order")
      .maybeSingle();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new Error(`Store "${code}" already exists in this workspace`);
      }
      throw new Error(error.message);
    }
    // No row back means the id was not in this workspace, or RLS refused it.
    // Reporting success there would leave the UI showing an edit the database
    // never took.
    if (!row) throw new Error("Store not found in this workspace");
    return row;
  });

export const deleteStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, ["owner", "admin"]);
    const { error } = await context.supabase.from("stores").delete().eq("workspace_id", wsId).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
