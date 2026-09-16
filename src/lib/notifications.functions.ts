import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import type { ServerContext } from "./server-context";

// Each handler is a plain `<name>Core(data, context)` function with a one-line
// createServerFn wrapper under it — see src/lib/server-context.ts for why.

export type NotificationRow = {
  id: string;
  workspace_id: string | null;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  title: string;
  body: string | null;
  data: any;
  read_at: string | null;
  created_at: string;
  workspace_name: string | null;
  actor_name: string | null;
};

const listInputSchema = z.object({ limit: z.number().int().min(1).max(100).optional() }).optional();

/** List the caller's most recent notifications (default 30). */
export async function listNotificationsCore(data: z.infer<typeof listInputSchema>, context: ServerContext) {
  const { supabase, userId } = context;
  const limit = data?.limit ?? 30;

  const { data: rows, error } = await supabase
    .from("notifications")
    .select("id, workspace_id, actor_id, action, entity_type, entity_id, title, body, data, read_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const list = rows ?? [];
  const wsIds = Array.from(new Set(list.map((r) => r.workspace_id).filter(Boolean))) as string[];
  const actorIds = Array.from(new Set(list.map((r) => r.actor_id).filter(Boolean))) as string[];

  const [wsRes, actorRes, unreadRes] = await Promise.all([
    wsIds.length
      ? supabase.from("workspaces").select("id, name").in("id", wsIds)
      : Promise.resolve({ data: [] as any[], error: null as any }),
    actorIds.length
      ? supabase.from("profiles").select("id, full_name, email").in("id", actorIds)
      : Promise.resolve({ data: [] as any[], error: null as any }),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null),
  ]);
  // BUG FIX: none of these three were checked. unreadRes's error mattered
  // most — a failed count query silently reported unreadCount: 0, hiding
  // unread notifications from the caller rather than failing visibly.
  if (wsRes.error) throw wsRes.error;
  if (actorRes.error) throw actorRes.error;
  if ((unreadRes as any).error) throw (unreadRes as any).error;

  const wsMap = new Map<string, string>((wsRes.data ?? []).map((w: any) => [w.id, w.name]));
  const actorMap = new Map<string, string>(
    (actorRes.data ?? []).map((p: any) => [p.id, p.full_name || p.email || "A teammate"]),
  );

  const notifications: NotificationRow[] = list.map((r: any) => ({
    ...r,
    workspace_name: r.workspace_id ? wsMap.get(r.workspace_id) ?? null : null,
    actor_name: r.actor_id ? actorMap.get(r.actor_id) ?? null : null,
  }));

  return {
    notifications,
    unreadCount: (unreadRes as any).count ?? 0,
  };
}

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => listInputSchema.parse(d))
  .handler(({ data, context }) => listNotificationsCore(data, context));

const markReadInputSchema = z.object({ id: z.string().uuid().optional(), all: z.boolean().optional() });

/** Mark one or all notifications as read. */
export async function markNotificationReadCore(data: z.infer<typeof markReadInputSchema>, context: ServerContext) {
  const { supabase, userId } = context;
  const now = new Date().toISOString();
  let q = supabase.from("notifications").update({ read_at: now }).eq("user_id", userId).is("read_at", null);
  if (data.id) q = q.eq("id", data.id);
  const { error } = await q;
  if (error) throw error;
  return { ok: true };
}

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => markReadInputSchema.parse(d))
  .handler(({ data, context }) => markNotificationReadCore(data, context));

const listPageInputSchema = z
  .object({
    filter: z.enum(["all", "unread"]).optional(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .optional();

/** Paginated list for a dedicated inbox page. */
export async function listNotificationsPageCore(data: z.infer<typeof listPageInputSchema>, context: ServerContext) {
  const { supabase, userId } = context;
  const offset = data?.offset ?? 0;
  const limit = data?.limit ?? 20;
  const filter = data?.filter ?? "all";

  let q = supabase
    .from("notifications")
    .select("id, workspace_id, actor_id, action, entity_type, entity_id, title, body, data, read_at, created_at", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (filter === "unread") q = q.is("read_at", null);

  const { data: rows, error, count } = await q;
  if (error) throw error;

  const list = rows ?? [];
  const wsIds = Array.from(new Set(list.map((r) => r.workspace_id).filter(Boolean))) as string[];
  const actorIds = Array.from(new Set(list.map((r) => r.actor_id).filter(Boolean))) as string[];
  const [wsRes, actorRes] = await Promise.all([
    wsIds.length ? supabase.from("workspaces").select("id, name").in("id", wsIds) : Promise.resolve({ data: [] as any[], error: null as any }),
    actorIds.length ? supabase.from("profiles").select("id, full_name, email").in("id", actorIds) : Promise.resolve({ data: [] as any[], error: null as any }),
  ]);
  // BUG FIX: neither error was checked, same as listNotificationsCore.
  if (wsRes.error) throw wsRes.error;
  if (actorRes.error) throw actorRes.error;

  const wsMap = new Map<string, string>((wsRes.data ?? []).map((w: any) => [w.id, w.name]));
  const actorMap = new Map<string, string>(
    (actorRes.data ?? []).map((p: any) => [p.id, p.full_name || p.email || "A teammate"]),
  );

  return {
    total: count ?? 0,
    notifications: list.map((r: any) => ({
      ...r,
      workspace_name: r.workspace_id ? wsMap.get(r.workspace_id) ?? null : null,
      actor_name: r.actor_id ? actorMap.get(r.actor_id) ?? null : null,
    })),
  };
}

export const listNotificationsPage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => listPageInputSchema.parse(d))
  .handler(({ data, context }) => listNotificationsPageCore(data, context));

/* ---------------- Notification preferences ---------------- */

export type NotificationPrefs = {
  emailDigest: boolean;
  anomalyAlerts: boolean;
  batchComplete: boolean;
};

const DEFAULT_PREFS: NotificationPrefs = {
  emailDigest: false,
  anomalyAlerts: true,
  batchComplete: true,
};

function normalizePrefs(raw: unknown): NotificationPrefs {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    emailDigest: typeof r.emailDigest === "boolean" ? r.emailDigest : DEFAULT_PREFS.emailDigest,
    anomalyAlerts: typeof r.anomalyAlerts === "boolean" ? r.anomalyAlerts : DEFAULT_PREFS.anomalyAlerts,
    batchComplete: typeof r.batchComplete === "boolean" ? r.batchComplete : DEFAULT_PREFS.batchComplete,
  };
}

/** Read the current user's notification preferences. */
export async function getNotificationPrefsCore(context: ServerContext) {
  const { supabase, userId } = context;
  const { data, error } = await supabase
    .from("profiles")
    .select("notification_prefs")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return normalizePrefs((data as any)?.notification_prefs);
}

export const getNotificationPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => getNotificationPrefsCore(context));

const updatePrefsInputSchema = z.object({
  emailDigest: z.boolean().optional(),
  anomalyAlerts: z.boolean().optional(),
  batchComplete: z.boolean().optional(),
});

/** Update the current user's notification preferences. */
export async function updateNotificationPrefsCore(data: z.infer<typeof updatePrefsInputSchema>, context: ServerContext) {
  const { supabase, userId } = context;
  // BUG FIX: this read's error was discarded. If it failed, `current`
  // silently became undefined and the merge below fell back to
  // DEFAULT_PREFS for every field the caller *didn't* touch — a partial
  // update (e.g. just flipping anomalyAlerts) could silently reset
  // emailDigest/batchComplete back to their defaults instead of preserving
  // whatever the caller actually had set.
  const { data: current, error: readErr } = await supabase
    .from("profiles")
    .select("notification_prefs")
    .eq("id", userId)
    .maybeSingle();
  if (readErr) throw readErr;
  const merged = normalizePrefs({ ...normalizePrefs((current as any)?.notification_prefs), ...data });
  const { error } = await supabase
    .from("profiles")
    .update({ notification_prefs: merged })
    .eq("id", userId);
  if (error) throw error;
  return merged;
}

export const updateNotificationPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => updatePrefsInputSchema.parse(d))
  .handler(({ data, context }) => updateNotificationPrefsCore(data, context));
