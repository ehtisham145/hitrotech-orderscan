// Recomputes a batch's aggregate counts from its extractions, and notifies
// workspace staff the first time a batch transitions to "completed".
//
// This is extract-core.server.ts's own copy of "recompute batch counts" —
// queue.functions.ts has a separate, independently-defined local copy that
// computes "active" slightly differently and doesn't fire notifications. See
// the Phase 4 plan's deferred-consolidation notes: merging the two changes
// behavior, so it's intentionally left alone here.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { nowIso } from "./time";
import { retryOnDeadlock } from "./db-retry.server";

type SB = SupabaseClient<Database>;

export async function syncBatchCounts(supabase: SB, batchId: string) {
  const { data: batchExtractions } = await supabase
    .from("extractions")
    .select("status, is_duplicate, anomalies")
    .eq("batch_id", batchId);
  if (!batchExtractions) return;

  const processed = batchExtractions.filter((e) => e.status === "success" && !e.is_duplicate).length;
  const failed = batchExtractions.filter((e) => e.status === "failed").length;
  const cancelled = batchExtractions.filter((e) => e.status === "cancelled").length;
  const paused = batchExtractions.filter((e) => e.status === "paused").length;
  const active = batchExtractions.filter((e) => ["pending", "processing", "ocr_completed", "extracting"].includes(e.status)).length;
  const dups = batchExtractions.filter((e) => e.is_duplicate).length;
  const anomalyRows = batchExtractions.filter(
    (e) => Array.isArray((e as any).anomalies) && ((e as any).anomalies as unknown[]).length > 0,
  ).length;
  const all = batchExtractions.length;
  const done = processed + failed + cancelled + dups;
  const nextStatus =
    active > 0
      ? "processing"
      : paused > 0
        ? "paused"
        : failed > 0 && processed === 0 && dups === 0 && cancelled === 0
          ? "failed"
          : done >= all
            ? "completed"
            : "completed";

  const { data: priorBatch } = await supabase
    .from("batches")
    .select("status, workspace_id, name")
    .eq("id", batchId)
    .maybeSingle();

  // Every extraction in the same batch races to update this one batches row
  // as it finishes — confirmed as a real deadlock source under an 18-image
  // bulk test (Postgres 40P01), same class of issue as the row-claim step.
  await retryOnDeadlock(
    () =>
      supabase
        .from("batches")
        .update({
          processed_count: processed,
          failed_count: failed,
          duplicate_count: dups,
          status: nextStatus,
          updated_at: nowIso(),
        })
        .eq("id", batchId)
        .select("id"),
    `syncBatchCounts write for batch ${batchId}`,
  );

  if (
    nextStatus === "completed" &&
    priorBatch &&
    priorBatch.status !== "completed" &&
    priorBatch.workspace_id
  ) {
    await notifyBatchCompleted(supabase, {
      batchId,
      workspaceId: priorBatch.workspace_id as string,
      batchName: (priorBatch as any).name ?? null,
      totals: { processed, failed, dups, anomalies: anomalyRows, all },
    });
  }
}

async function notifyBatchCompleted(
  supabase: SB,
  args: {
    batchId: string;
    workspaceId: string;
    batchName: string | null;
    totals: { processed: number; failed: number; dups: number; anomalies: number; all: number };
  },
) {
  const { batchId, workspaceId, batchName, totals } = args;

  const { data: members } = await supabase
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", workspaceId);
  if (!members?.length) return;

  const staff = members.filter((m) =>
    ["owner", "admin", "manager", "employee", "operator"].includes(String((m as any).role)),
  );
  if (!staff.length) return;

  const userIds = staff.map((m) => (m as any).user_id as string);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, notification_prefs")
    .in("id", userIds);
  const prefById = new Map<string, { batchComplete: boolean; anomalyAlerts: boolean }>();
  for (const p of profiles ?? []) {
    const raw = ((p as any).notification_prefs ?? {}) as Record<string, unknown>;
    prefById.set((p as any).id as string, {
      batchComplete: typeof raw.batchComplete === "boolean" ? raw.batchComplete : true,
      anomalyAlerts: typeof raw.anomalyAlerts === "boolean" ? raw.anomalyAlerts : true,
    });
  }

  const label = batchName ? `"${batchName}"` : "your batch";
  const nowIsoString = nowIso();
  const rows: Array<Record<string, unknown>> = [];

  for (const userId of userIds) {
    const p = prefById.get(userId) ?? { batchComplete: true, anomalyAlerts: true };
    if (p.batchComplete) {
      rows.push({
        workspace_id: workspaceId,
        user_id: userId,
        action: "batch.completed",
        entity_type: "batch",
        entity_id: batchId,
        title: `Batch ${label} finished`,
        body: `${totals.processed} processed · ${totals.failed} failed · ${totals.dups} duplicates`,
        created_at: nowIsoString,
      });
    }
    if (p.anomalyAlerts && totals.anomalies > 0) {
      rows.push({
        workspace_id: workspaceId,
        user_id: userId,
        action: "batch.anomalies_detected",
        entity_type: "batch",
        entity_id: batchId,
        title: `${totals.anomalies} anomaly${totals.anomalies === 1 ? "" : "ies"} in ${label}`,
        body: "Review flagged activations on the Anomalies page.",
        data: { batch_id: batchId, count: totals.anomalies },
        created_at: nowIsoString,
      });
    }
  }

  if (rows.length) {
    await supabase.from("notifications").insert(rows as any);
  }
}
