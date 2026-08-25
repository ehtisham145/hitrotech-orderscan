// Inngest client + function definitions. Signing key auto-loaded from
// INNGEST_SIGNING_KEY at first request.
import { Inngest, NonRetriableError } from "inngest";

type StaleExtraction = {
  id: string;
  batch_id: string;
  status: string | null;
  updated_at: string | null;
};

export const inngest = new Inngest({ id: "orderscan-ai" });

export const extractImage = inngest.createFunction(
  {
    id: "extract-image",
    concurrency: [{ limit: 6 }, { limit: 2, key: "event.data.batch_id" }],
    // Transient failures (network blips, provider 5xx) get retried with
    // Inngest's built-in exponential backoff. Permanent errors are thrown as
    // NonRetriableError below so we don't hammer the provider or waste steps.
    retries: 3,
    triggers: [{ event: "extraction/requested" }],
  },
  async ({ event, step }) => {
    const extractionId = (event.data as { extraction_id?: string } | undefined)?.extraction_id;
    if (!extractionId) {
      throw new NonRetriableError("Missing extraction_id in event data");
    }

    const result = await step.run("run-extraction", async () => {
      const { runExtraction } = await import("@/lib/extract-core.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await runExtraction(supabaseAdmin as any, extractionId);
        if (!result.ok) {
          if (/rate|retry|capacity|ocr_failed/i.test(result.error)) throw new Error(result.error);
          if (
            /paused|cancelled|not_found|empty_extraction|credits exhausted|no_ocr_text|no_ocr_config|already_(success|failed|cancelled|paused)/i.test(
              result.error,
            )
          ) {
            throw new NonRetriableError(result.error);
          }
          throw new Error(result.error);
        }
        return result;
      } catch (err) {
        // Classify: rows we can't find, or already-terminal state, are permanent.
        const msg = err instanceof Error ? err.message : String(err);
        if (
          /not\s*found/i.test(msg) ||
          /already\s*(completed|failed)/i.test(msg) ||
          /invalid\s*(image|mime|input)/i.test(msg)
        ) {
          throw new NonRetriableError(msg);
        }
        throw err; // transient — let Inngest retry with backoff
      }
    });

    return result;
  },
);

export const requeueStaleExtractions = inngest.createFunction(
  {
    id: "requeue-stale-extractions",
    concurrency: { limit: 1 },
    retries: 1,
    triggers: [{ cron: "*/2 * * * *" }],
  },
  async ({ step }) => {
    const rows = await step.run("find-stale-extractions", async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");
      const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
      const { data, error } = await supabaseAdmin
        .from("extractions")
        .select("id, batch_id, status, updated_at")
        .in("status", ["pending", "processing"])
        .lt("updated_at", cutoff)
        .limit(50);
      if (error) throw error;
      return ((data ?? []) as StaleExtraction[]).filter((row): row is StaleExtraction =>
        Boolean(row.batch_id),
      );
    });

    if (rows.length === 0) return { requeued: 0 };

    await step.run("mark-stale-as-pending", async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/ext-client.server");
      const ids = rows.map((row) => row.id);
      const batchIds = Array.from(new Set(rows.map((row) => row.batch_id)));
      await supabaseAdmin
        .from("extractions")
        .update({
          status: "pending",
          error_message: "Recovered stale processing job — retrying automatically",
          updated_at: new Date().toISOString(),
        })
        .in("id", ids)
        .in("status", ["pending", "processing"]);
      if (batchIds.length > 0) {
        await supabaseAdmin
          .from("batches")
          .update({ status: "processing", updated_at: new Date().toISOString() })
          .in("id", batchIds);
      }
    });

    await step.sendEvent(
      "requeue-stale-extractions",
      rows.map((row) => ({
        name: "extraction/requested",
        data: { extraction_id: row.id, batch_id: row.batch_id },
      })),
    );

    return { requeued: rows.length };
  },
);
