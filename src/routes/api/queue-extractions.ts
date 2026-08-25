import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { inngest } from "@/lib/inngest.server";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function nowIso() {
  return new Date().toISOString();
}

function isStaleProcessing(updatedAt: unknown) {
  const updatedAtMs = Date.parse(String(updatedAt ?? ""));
  return !Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > 2 * 60_000;
}

export const Route = createFileRoute("/api/queue-extractions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authHeader = request.headers.get("authorization");
          if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);

          const { extraction_ids } = (await request.json()) as { extraction_ids?: string[] };
          const requested = Array.from(new Set(extraction_ids ?? [])).filter(Boolean);
          if (requested.length === 0) return json({ ok: true, queued: 0 });

          const SUPABASE_URL = process.env.EXT_SUPABASE_URL!;
          const SUPABASE_KEY = process.env.EXT_SUPABASE_PUBLISHABLE_KEY!;
          const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
            global: { headers: { Authorization: authHeader, apikey: SUPABASE_KEY } },
            auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
          });

          const { data: userData, error: userError } = await supabase.auth.getUser(authHeader.slice(7));
          if (userError || !userData.user) return json({ ok: false, error: "Unauthorized" }, 401);

          const { data: rows, error } = await supabase
            .from("extractions")
            .select("id, batch_id, status, updated_at")
            .in("id", requested);
          if (error) throw new Error(error.message);

          const ids = (rows ?? [])
            .filter((r) => r.status !== "processing" || isStaleProcessing(r.updated_at))
            .map((r) => r.id);
          if (ids.length === 0) return json({ ok: true, queued: 0 });
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
              const { data: batchExtractions } = await supabase
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

              await supabase
                .from("batches")
                .update({ processed_count: processed, failed_count: failed, duplicate_count: dups, status: nextStatus, updated_at: nowIso() })
                .eq("id", batchId);
            }
          };

          const keepPendingForDirectProcessing = async (failedIds: string[]) => {
            if (failedIds.length === 0) return;
            await supabase
              .from("extractions")
              .update({ status: "pending", error_message: "Processing directly from the batch page", updated_at: nowIso() })
              .in("id", failedIds);
            const affectedBatchIds = (rows ?? [])
              .filter((r) => failedIds.includes(r.id))
              .map((r) => r.batch_id)
              .filter((batchId): batchId is string => Boolean(batchId));
            await syncBatchCounts(affectedBatchIds);
          };

          await supabase.from("extractions").update({ status: "pending", error_message: null, updated_at: nowIso() }).in("id", ids);
          if (batchIds.length > 0) {
            await supabase.from("batches").update({ status: "processing", updated_at: nowIso() }).in("id", batchIds);
          }

          if (!process.env.INNGEST_EVENT_KEY) {
            await keepPendingForDirectProcessing(ids);
            return json({ ok: true, queued: 0, failed_to_queue: ids.length, fallback: "direct" }, 202);
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
              console.error(`[queue-extractions] durable queue failed: ${err instanceof Error ? err.message : String(err)}`);
              await keepPendingForDirectProcessing(ids.slice(i));
              return json({ ok: true, queued, failed_to_queue: ids.length - queued, fallback: "direct" }, 202);
            }
            queued += chunk.length;
          }

          return json({ ok: true, queued });
        } catch (err) {
          console.error("[queue-extractions] error", err);
          return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
        }
      },
    },
  },
});
