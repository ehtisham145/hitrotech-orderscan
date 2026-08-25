// Reliability features: audit trail, anomalies, month locks, monthly backup.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { requireActiveWorkspaceId } from "./workspace-helpers";
import { assertActiveWorkspaceRole } from "./authz.server";
import { slabsEffectiveOn } from "./brand-slabs";

const LOCK_ROLES = ["owner", "admin"] as const;

function monthStart(input?: string) {
  const s = (input ?? new Date().toISOString().slice(0, 8) + "01").slice(0, 8) + "01";
  return s;
}

// ---------------------------------------------------------------
// AUDIT
// ---------------------------------------------------------------

export type AuditLogRow = {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: any;
  created_at: string;
  actor_email?: string | null;
};

export const listAuditLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { entity_type?: string; entity_id?: string; limit?: number }) => input)
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("audit_logs")
      .select("id, user_id, action, entity_type, entity_id, details, created_at")
      .order("created_at", { ascending: false })
      .limit(Math.min(data.limit ?? 100, 500));
    if (data.entity_type) q = q.eq("entity_type", data.entity_type);
    if (data.entity_id) q = q.eq("entity_id", data.entity_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const userIds = Array.from(
      new Set(((rows ?? []) as Array<{ user_id: string | null }>).map((r) => r.user_id).filter(Boolean) as string[]),
    );
    let emailMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await context.supabase.from("profiles").select("id, email").in("id", userIds);
      emailMap = new Map(((profiles ?? []) as Array<{ id: string; email: string | null }>).map((p) => [p.id, p.email ?? ""]));
    }
    return ((rows ?? []) as AuditLogRow[]).map((r) => ({
      ...r,
      actor_email: r.user_id ? emailMap.get(r.user_id) ?? null : null,
    }));
  });

// ---------------------------------------------------------------
// ANOMALIES
// ---------------------------------------------------------------

export const listAnomalies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month?: string }) => input)
  .handler(async ({ data, context }) => {
    const m = monthStart(data.month);
    const monthEnd = new Date(m);
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    const endStr = monthEnd.toISOString().slice(0, 10);

    // Rows flagged by the DB trigger
    const { data: flagged, error } = await context.supabase
      .from("extractions")
      .select(
        "id, batch_id, customer_name, phone_number, order_number, store_id, activation_date, activation_date_parsed, employee_name, partner_id, commission_month, anomalies, created_at",
      )
      .gte("created_at", m)
      .lt("created_at", endStr)
      .not("anomalies", "eq", "{}")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    // Extra scan: same phone appearing more than once this month (successful, non-duplicate)
    const { data: pool } = await context.supabase
      .from("extractions")
      .select("id, phone_number, created_at, customer_name, store_id, employee_name, batch_id, order_number, activation_date, partner_id, commission_month, anomalies")
      .eq("status", "success")
      .eq("is_duplicate", false)
      .eq("commission_month", m)
      .not("phone_number", "is", null);

    type PoolRow = {
      id: string;
      phone_number: string | null;
      created_at: string;
      customer_name: string | null;
      store_id: string | null;
      employee_name: string | null;
      batch_id: string;
      order_number: string | null;
      activation_date: string | null;
      partner_id: string | null;
      commission_month: string | null;
      anomalies: string[] | null;
    };
    const groups = new Map<string, PoolRow[]>();
    for (const r of (pool ?? []) as PoolRow[]) {
      const norm = (r.phone_number ?? "").replace(/\D/g, "");
      if (norm.length < 10) continue;
      const key = norm.slice(-10);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    const repeated: Array<PoolRow & { anomalies: string[] }> = [];
    for (const [, list] of groups) {
      if (list.length >= 2) {
        for (const r of list) {
          const flags = new Set<string>(r.anomalies ?? []);
          flags.add("repeat_phone_this_month");
          repeated.push({ ...r, anomalies: Array.from(flags) });
        }
      }
    }

    // Merge: flagged rows + repeated rows (dedupe by id, prefer merged flags)
    const map = new Map<string, PoolRow & { anomalies: string[] }>();
    for (const r of (flagged ?? []) as PoolRow[]) {
      map.set(r.id, { ...r, anomalies: r.anomalies ?? [] });
    }
    for (const r of repeated) {
      const prev = map.get(r.id);
      if (prev) {
        const merged = new Set([...(prev.anomalies ?? []), ...r.anomalies]);
        map.set(r.id, { ...prev, anomalies: Array.from(merged) });
      } else {
        map.set(r.id, r);
      }
    }

    const list = Array.from(map.values()).sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
    return { month: m, rows: list };
  });

// ---------------------------------------------------------------
// MONTH LOCKS
// ---------------------------------------------------------------

export const listMonthLocks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("month_locks")
      .select("month, locked_at, locked_by, notes")
      .order("month", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const isMonthLocked = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string }) => input)
  .handler(async ({ data, context }) => {
    const m = monthStart(data.month);
    const { data: row } = await context.supabase
      .from("month_locks")
      .select("month, locked_at, locked_by, notes")
      .eq("month", m)
      .maybeSingle();
    let lockedByName: string | null = null;
    if (row?.locked_by) {
      const { data: prof } = await context.supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", row.locked_by)
        .maybeSingle();
      lockedByName = prof?.full_name || prof?.email || null;
    }
    return { locked: !!row, row: row ? { ...row, locked_by_name: lockedByName } : null };
  });

export const lockMonth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string; notes?: string | null }) => input)
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...LOCK_ROLES]);
    const m = monthStart(data.month);
    const { error } = await context.supabase
      .from("month_locks")
      .upsert({ workspace_id: wsId, month: m, locked_by: context.userId, notes: data.notes ?? null }, { onConflict: "workspace_id,month" });
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      workspace_id: wsId,
      action: "month.locked",
      entity_type: "month_lock",
      entity_id: null,
      details: { month: m, notes: data.notes ?? null },
    });
    return { ok: true };
  });

export const unlockMonth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string }) => input)
  .handler(async ({ data, context }) => {
    const wsId = await assertActiveWorkspaceRole(context.supabase, context.userId, [...LOCK_ROLES]);
    const m = monthStart(data.month);
    const { error } = await context.supabase.from("month_locks").delete().eq("workspace_id", wsId).eq("month", m);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      workspace_id: wsId,
      action: "month.unlocked",
      entity_type: "month_lock",
      entity_id: null,
      details: { month: m },
    });
    return { ok: true };
  });

/** Recent lock/unlock events for the active workspace, most recent first. */
export const listMonthLockHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month?: string; limit?: number }) => input)
  .handler(async ({ data, context }) => {
    const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
    const limit = Math.min(Math.max(data.limit ?? 20, 1), 100);
    let q = context.supabase
      .from("audit_logs")
      .select("id, user_id, action, details, created_at")
      .eq("workspace_id", wsId)
      .in("action", ["month.locked", "month.unlocked"])
      .order("created_at", { ascending: false })
      .limit(limit);
    if (data.month) {
      const m = monthStart(data.month);
      q = q.contains("details", { month: m });
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id).filter(Boolean)));
    const profMap = new Map<string, string>();
    if (userIds.length) {
      const { data: profs } = await context.supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      for (const p of profs ?? []) profMap.set((p as any).id, (p as any).full_name || (p as any).email || "");
    }
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      action: r.action as "month.locked" | "month.unlocked",
      created_at: r.created_at,
      actor_name: r.user_id ? profMap.get(r.user_id) ?? null : null,
      month: r.details?.month ?? null,
      notes: r.details?.notes ?? null,
    }));
  });

// ---------------------------------------------------------------
// RECONCILIATION — compare payout snapshot vs live activation count
// ---------------------------------------------------------------

export const getReconciliation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string }) => input)
  .handler(async ({ data, context }) => {
    const m = monthStart(data.month);
    const [payoutsRes, extRes, partnersRes] = await Promise.all([
      context.supabase
        .from("partner_payouts")
        .select("id, partner_id, activations_count, amount_pkr, snapshot_count, snapshot_amount, snapshot_at, status")
        .eq("month", m),
      context.supabase
        .from("extractions")
        .select("partner_id, commission_amount")
        .eq("status", "success")
        .eq("is_duplicate", false)
        .eq("commission_month", m)
        .not("partner_id", "is", null),
      context.supabase.from("partners").select("id, name"),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payouts = (payoutsRes.data ?? []) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = (extRes.data ?? []) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const partners = (partnersRes.data ?? []) as any[];
    const nameById = new Map<string, string>(partners.map((p) => [p.id, p.name]));

    const live = new Map<string, { count: number; amount: number }>();
    for (const r of ext) {
      const s = live.get(r.partner_id) ?? { count: 0, amount: 0 };
      s.count += 1;
      s.amount += r.commission_amount ?? 0;
      live.set(r.partner_id, s);
    }

    const rows = payouts
      .map((p) => {
        const l = live.get(p.partner_id) ?? { count: 0, amount: 0 };
        const snapCount = p.snapshot_count ?? p.activations_count ?? 0;
        const snapAmount = p.snapshot_amount ?? p.amount_pkr ?? 0;
        return {
          partner_id: p.partner_id as string,
          name: nameById.get(p.partner_id) ?? "—",
          status: p.status as string,
          snapshot_count: snapCount,
          snapshot_amount: snapAmount,
          live_count: l.count,
          live_amount: l.amount,
          delta_count: l.count - snapCount,
          delta_amount: l.amount - snapAmount,
          snapshot_at: p.snapshot_at as string | null,
        };
      })
      .filter((r) => r.delta_count !== 0 || r.delta_amount !== 0)
      .sort((a, b) => Math.abs(b.delta_amount) - Math.abs(a.delta_amount));

    return { month: m, rows };
  });

// ---------------------------------------------------------------
// MONTHLY BACKUP EXPORT
// ---------------------------------------------------------------

export const exportMonthlyBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string }) => input)
  .handler(async ({ data, context }) => {
    const m = monthStart(data.month);
    const monthEndDate = new Date(m);
    monthEndDate.setMonth(monthEndDate.getMonth() + 1);
    const monthEnd = monthEndDate.toISOString().slice(0, 10);

    // Verify caller is manager/admin (RPC uses their JWT)
    const { data: allowed } = await context.supabase.rpc("is_manager_or_admin", { _user_id: context.userId });
    if (!allowed) throw new Error("Forbidden");

    const [extRes, payoutsRes, partnersRes, batchesRes, slabsRes] = await Promise.all([
      context.supabase
        .from("extractions")
        .select("*")
        .gte("created_at", m)
        .lt("created_at", monthEnd)
        .order("created_at", { ascending: true })
        .limit(20000),
      context.supabase.from("partner_payouts").select("*").eq("month", m),
      context.supabase.from("partners").select("id, name, role, store_id, phone, cnic"),
      context.supabase.from("batches").select("id, name, created_at").gte("created_at", m).lt("created_at", monthEnd),
      context.supabase.from("commission_slabs").select("role, min_count, max_count, rate_pkr, active, effective_from, effective_to"),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extractions = (extRes.data ?? []) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payouts = (payoutsRes.data ?? []) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const partners = (partnersRes.data ?? []) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batches = (batchesRes.data ?? []) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const slabs = slabsEffectiveOn((slabsRes.data ?? []) as any[], m);

    const partnerNameById = new Map<string, string>(partners.map((p) => [p.id, p.name]));
    const batchNameById = new Map<string, string>(batches.map((b) => [b.id, b.name]));

    const extRows = extractions.map((r) => ({
      Batch: batchNameById.get(r.batch_id) ?? "",
      Status: r.status,
      "Order #": r.order_number,
      Customer: r.customer_name,
      Phone: r.phone_number,
      CNIC: r.cnic,
      Store: r.store_id,
      Reference: r.reference,
      Employee: r.employee_name,
      Branch: r.branch_name,
      "Activation Date": r.activation_date,
      "Plan Price": r.plan_price,
      Duplicate: r.is_duplicate ? "YES" : "",
      "Needs Review": r.needs_review ? "YES" : "",
      Anomalies: (r.anomalies ?? []).join(", "),
      Partner: r.partner_id ? partnerNameById.get(r.partner_id) ?? "" : "",
      Commission: r.commission_amount ?? "",
      "Commission Month": r.commission_month,
      Created: r.created_at,
    }));

    const payoutRows = payouts.map((p) => ({
      Partner: partnerNameById.get(p.partner_id) ?? "",
      Month: p.month,
      Activations: p.activations_count,
      Rate: p.rate_pkr,
      Amount: p.amount_pkr,
      Status: p.status,
      "Paid At": p.paid_at,
      Reference: p.payment_reference,
      Notes: p.notes,
      "Snapshot Count": p.snapshot_count,
      "Snapshot Amount": p.snapshot_amount,
      "Snapshot At": p.snapshot_at,
    }));

    const partnerRows = partners.map((p) => ({
      Name: p.name,
      Role: p.role,
      Store: p.store_id,
      Phone: p.phone,
      CNIC: p.cnic,
    }));

    const slabRows = slabs.map((s) => ({
      Role: s.role,
      Min: s.min_count,
      Max: s.max_count,
      "Rate (PKR)": s.rate_pkr,
      Active: s.active ? "YES" : "",
    }));

    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(extRows.length ? extRows : [{ "": "No rows" }]), "Extractions");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(payoutRows.length ? payoutRows : [{ "": "No rows" }]), "Payouts");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(partnerRows.length ? partnerRows : [{ "": "No rows" }]), "Partners");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(slabRows.length ? slabRows : [{ "": "No rows" }]), "Commission Slabs");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = `${context.userId}/backups/${m.slice(0, 7)}-${stamp}.xlsx`;

    const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");
    const { error: upErr } = await supabaseAdmin.storage.from("reports").upload(path, buf, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });
    if (upErr) throw new Error(upErr.message);

    const wsIdForReport = await requireActiveWorkspaceId(context.supabase, context.userId);
    await supabaseAdmin.from("generated_reports").insert({
      user_id: context.userId,
      workspace_id: wsIdForReport,
      name: `Monthly backup — ${m.slice(0, 7)}`,
      storage_path: path,
      row_count: extRows.length,
    });

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from("reports")
      .createSignedUrl(path, 60 * 60 * 24);
    if (signErr || !signed?.signedUrl) throw new Error(signErr?.message ?? "Failed to sign url");

    return {
      path,
      url: signed.signedUrl,
      counts: { extractions: extRows.length, payouts: payoutRows.length, partners: partnerRows.length },
    };
  });
