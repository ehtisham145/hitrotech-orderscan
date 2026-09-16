// Server functions that queue extraction jobs onto Inngest via the connector
// gateway. All keys are server-only; the browser never sees them.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { inngest } from "@/lib/inngest.server";
import { requireActiveWorkspaceId } from "./workspace-helpers";
import type { Database } from "@/integrations/supabase/types";

type ServerContext = { supabase: SupabaseClient<Database>; userId: string };

// Handler logic pulled out of createServerFn(...).handler() so it's callable
// directly from Vitest without a real HTTP request: requireSupabaseAuth
// (the middleware every createServerFn export here uses) calls getRequest(),
// which only resolves inside one. createServerFn(...).handler() below is now
// a one-line call-through to this — same behavior, just testable.
export async function queueExtractionsCore(data: { extraction_ids: string[] }, context: ServerContext) {
    const nowIso = () => new Date().toISOString();
    const isStaleProcessing = (updatedAt: unknown) => {
      const updatedAtMs = Date.parse(String(updatedAt ?? ""));
      return !Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > 2 * 60_000;
    };

    const requested = Array.from(new Set(data.extraction_ids ?? [])).filter(Boolean);
    if (requested.length === 0) return { queued: 0, failed_to_queue: 0 };
    // Verify caller owns these rows (active workspace only).
    const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("extractions")
      .select("id, batch_id, status, updated_at")
      .eq("workspace_id", wsId)
      .in("id", requested);
    if (error) throw new Error(error.message);
    const ids = (rows ?? [])
      .filter((r) => r.status !== "processing" || isStaleProcessing(r.updated_at))
      .map((r) => r.id);
    if (ids.length === 0) return { queued: 0, failed_to_queue: 0 };
    const batchIdByExtractionId = new Map((rows ?? []).map((r) => [r.id, r.batch_id]));
    const batchIds = Array.from(
      new Set(
        (rows ?? [])
          .filter((r) => ids.includes(r.id))
          .map((r) => r.batch_id)
          .filter((batchId): batchId is string => Boolean(batchId)),
      ),
    );

    const syncBatchCounts = async (affectedBatchIds: string[]) => {
      for (const batchId of Array.from(new Set(affectedBatchIds))) {
        const { data: batchExtractions } = await context.supabase
          .from("extractions")
          .select("status, is_duplicate")
          .eq("workspace_id", wsId)
          .eq("batch_id", batchId);
        if (!batchExtractions) continue;

        const processed = batchExtractions.filter((e) => e.status === "success" && !e.is_duplicate).length;
        const failed = batchExtractions.filter((e) => e.status === "failed").length;
        const cancelled = batchExtractions.filter((e) => e.status === "cancelled").length;
        const paused = batchExtractions.filter((e) => e.status === "paused").length;
        const active = batchExtractions.filter((e) => e.status === "pending" || e.status === "processing").length;
        const dups = batchExtractions.filter((e) => e.is_duplicate).length;
        const done = processed + failed + cancelled + dups;
        const all = batchExtractions.length;
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

        await context.supabase
          .from("batches")
          .update({ processed_count: processed, failed_count: failed, duplicate_count: dups, status: nextStatus, updated_at: nowIso() })
          .eq("workspace_id", wsId)
          .eq("id", batchId);
      }
    };

    const keepPendingForDirectProcessing = async (failedIds: string[]) => {
      if (failedIds.length === 0) return;
      await context.supabase
        .from("extractions")
        .update({ status: "pending", error_message: "Processing directly from the batch page", updated_at: nowIso() })
        .in("id", failedIds);
      const affectedBatchIds = (rows ?? [])
        .filter((r) => failedIds.includes(r.id))
        .map((r) => r.batch_id)
        .filter((batchId): batchId is string => Boolean(batchId));
      await syncBatchCounts(affectedBatchIds);
    };

    // Reset to pending so users can see them enter the queue.
    await context.supabase
      .from("extractions")
      .update({ status: "pending", error_message: null, updated_at: nowIso() })
      .in("id", ids);
    if (batchIds.length > 0) {
      await context.supabase.from("batches").update({ status: "processing", updated_at: nowIso() }).eq("workspace_id", wsId).in("id", batchIds);
    }

    if (!process.env.INNGEST_EVENT_KEY && !process.env.INNGEST_SIGNING_KEY) {
      await keepPendingForDirectProcessing(ids);
      return { queued: 0, failed_to_queue: ids.length, fallback: "direct" as const };
    }

    let queued = 0;
    const chunkSize = 50;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      try {
        await inngest.send(
          chunk.map((extractionId) => ({
            name: "extraction/requested",
            data: { extraction_id: extractionId, batch_id: batchIdByExtractionId.get(extractionId) },
          })),
        );
      } catch (err) {
        console.error(`[queue] durable queue failed: ${err instanceof Error ? err.message : String(err)}`);
        await keepPendingForDirectProcessing(ids.slice(i));
        return { queued, failed_to_queue: ids.length - queued, fallback: "direct" as const };
      }
      queued += chunk.length;
    }

    return { queued, failed_to_queue: 0 };
}

export const queueExtractions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { extraction_ids: string[] }) => input)
  .handler(({ data, context }) => queueExtractionsCore(data, context));

export async function processExtractionNowCore(data: { extraction_id: string }, context: ServerContext) {
    const nowIso = () => new Date().toISOString();

    const extractionId = String(data.extraction_id ?? "").trim();
    if (!extractionId) throw new Error("Missing extraction_id");

    // RLS verifies the signed-in user can access the row before the extraction
    // routine touches storage or writes results.
    const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("extractions")
      .select("id")
      .eq("workspace_id", wsId)
      .eq("id", extractionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Extraction not found");

    // Runs in-process on this deployment. extract-core.server prefers a direct
    // GEMINI_API_KEY and only falls back to the Lovable AI gateway if unset.
    const { runExtraction } = await import("@/lib/extract-core.server");
    const result = (await runExtraction(context.supabase, extractionId)) as { ok: boolean; error?: string };

    // Keep transient infrastructure/provider issues retryable instead of turning
    // an entire batch into permanent failures. Deliberately excludes
    // already_processing/already_claimed: that means a *different* caller won
    // the atomic claim in extract-core.server and is actively working the row
    // right now — resetting it to "pending" here would rip it out from under
    // that in-flight worker instead of just being this caller's own no-op.
    // save_failed added after a real bulk test left 5 rows permanently
    // "failed" on a DB deadlock/statement-timeout at the save step — the
    // extraction itself had already succeeded, only the write lost the race,
    // so it's exactly as retryable as claim_failed already next to it.
    if (!result.ok && /AI not configured|AI rate limit|retrying|capacity|claim_failed|save_failed|proxy_/i.test(String(result.error))) {
      await context.supabase
        .from("extractions")
        .update({ status: "pending", error_message: `${result.error} — retrying automatically`, updated_at: nowIso() })
        .eq("workspace_id", wsId)
        .eq("id", extractionId)
        .in("status", ["failed", "processing"]);
    }

    return result;
}

export const processExtractionNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { extraction_id: string }) => input)
  .handler(({ data, context }) => processExtractionNowCore(data, context));

/**
 * Republishes updated_at on a batch's still-queued rows.
 *
 * Stale-job recovery treats any row left in pending/processing past a two
 * minute cutoff as abandoned and requeues it. Rows waiting their turn behind a
 * long batch look exactly like that, so a worker watching the same database
 * picks them up mid-run. Called on an interval by an open batch page for as
 * long as it is actually driving the batch; RLS scopes it to the caller's own
 * rows.
 */
export async function keepBatchRowsFreshCore(data: { batch_id: string }, context: ServerContext) {
    if (!data.batch_id) return { refreshed: 0 };

    const wsId = await requireActiveWorkspaceId(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("extractions")
      .update({ updated_at: new Date().toISOString() })
      .eq("workspace_id", wsId)
      .eq("batch_id", data.batch_id)
      .eq("status", "pending")
      .select("id");
    if (error) throw new Error(error.message);

    return { refreshed: rows?.length ?? 0 };
}

export const keepBatchRowsFresh = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { batch_id: string }) => input)
  .handler(({ data, context }) => keepBatchRowsFreshCore(data, context));
