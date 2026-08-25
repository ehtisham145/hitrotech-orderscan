// Server functions that queue extraction jobs onto Inngest via the connector
// gateway. All keys are server-only; the browser never sees them.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/ext-auth-middleware";
import { inngest } from "@/lib/inngest.server";

export const queueExtractions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { extraction_ids: string[] }) => input)
  .handler(async ({ data, context }) => {
    const nowIso = () => new Date().toISOString();
    const isStaleProcessing = (updatedAt: unknown) => {
      const updatedAtMs = Date.parse(String(updatedAt ?? ""));
      return !Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > 2 * 60_000;
    };

    const requested = Array.from(new Set(data.extraction_ids ?? [])).filter(Boolean);
    if (requested.length === 0) return { queued: 0, failed_to_queue: 0 };
    // Verify caller owns these rows.
    const { data: rows, error } = await context.supabase
      .from("extractions")
      .select("id, batch_id, status, updated_at")
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
      await context.supabase.from("batches").update({ status: "processing", updated_at: nowIso() }).in("id", batchIds);
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
  });

export const processExtractionNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { extraction_id: string }) => input)
  .handler(async ({ data, context }) => {
    const nowIso = () => new Date().toISOString();

    const extractionId = String(data.extraction_id ?? "").trim();
    if (!extractionId) throw new Error("Missing extraction_id");

    // RLS verifies the signed-in user can access the row before the extraction
    // routine touches storage or writes results.
    const { data: row, error } = await context.supabase
      .from("extractions")
      .select("id")
      .eq("id", extractionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Extraction not found");

    // Runs in-process on this deployment. extract-core.server prefers a direct
    // GEMINI_API_KEY and only falls back to the Lovable AI gateway if unset.
    const { runExtraction } = await import("@/lib/extract-core.server");
    const result = (await runExtraction(context.supabase, extractionId)) as { ok: boolean; error?: string };

    // Keep transient infrastructure/provider issues retryable instead of turning
    // an entire batch into permanent failures.
    if (!result.ok && /AI not configured|AI rate limit|retrying|capacity|already_processing|already_claimed|proxy_/i.test(String(result.error))) {
      await context.supabase
        .from("extractions")
        .update({ status: "pending", error_message: `${result.error} — retrying automatically`, updated_at: nowIso() })
        .eq("id", extractionId)
        .in("status", ["failed", "processing"]);
    }

    return result;
  });
