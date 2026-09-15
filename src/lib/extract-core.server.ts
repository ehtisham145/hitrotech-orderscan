// Core AI extraction routine. Callable from an auth-verified route or from a
// background Inngest worker. Uses the admin client so it works without a user
// session; the caller is responsible for authorizing the request first.
//
// The prompt/schema, OCR read, and batch-count-sync concerns live in
// src/lib/extraction/ — this file is the orchestration entry point:
// claim the row, read the screenshot, try the free template path, fall back
// to the AI, and persist the result.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { normalizePhone, normalizeCnic, avgConfidence, EXTRACT_FIELDS } from "@/lib/format";
import { tryTemplateExtraction } from "@/lib/template-extract";
import { SYSTEM_PROMPT, ExtractionSchema } from "@/lib/extraction/prompt";
import { readWithOcr } from "@/lib/extraction/ocr-read.server";
import { syncBatchCounts } from "@/lib/extraction/batch-sync.server";
import { nowIso } from "@/lib/extraction/time";
import { retryOnDeadlock } from "@/lib/extraction/db-retry.server";

type SB = SupabaseClient<Database>;

export type RunExtractionResult =
  | { ok: true; extraction_id: string }
  | { ok: false; error: string };

// How often a row being actively worked on republishes its updated_at. Must stay
// comfortably under the staleness cutoff used by requeueStaleExtractions
// (2 minutes) so a slow-but-healthy job is never mistaken for a dead one.
const HEARTBEAT_INTERVAL_MS = 30_000;

// Upper bound on the AI provider call, so a stalled request surfaces as a
// failure instead of holding the row open indefinitely.
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 90_000;

// Screenshots are sent inline as base64, which costs roughly a third more than
// the raw bytes. Uploads this large are a sign something other than a phone
// screenshot got through, and are worth rejecting before paying to send them.
const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES) || 12 * 1024 * 1024;

/**
 * Runs an extraction, keeping the row's updated_at fresh for as long as the work
 * is actually in flight.
 *
 * Without this, any worker watching for stale jobs (ours or another deployment
 * pointed at the same database) sees a row whose extraction simply takes longer
 * than the staleness cutoff, assumes the job died, and requeues it — so two
 * workers end up racing over one row and the slower-but-correct result loses.
 */
export async function runExtraction(supabase: SB, extractionId: string): Promise<RunExtractionResult> {
  const heartbeat = setInterval(() => {
    void (async () => {
      try {
        // Guarded on status so a finished/cancelled row is never resurrected by
        // an in-flight tick.
        await supabase
          .from("extractions")
          .update({ updated_at: nowIso() })
          .eq("id", extractionId)
          .eq("status", "processing");
      } catch {
        // A dropped heartbeat is harmless on its own — the next tick retries.
      }
    })();
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  try {
    return await runExtractionUnguarded(supabase, extractionId);
  } finally {
    clearInterval(heartbeat);
  }
}

async function runExtractionUnguarded(supabase: SB, extractionId: string): Promise<RunExtractionResult> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  // Optional, free, text-only fallback tried ahead of Gemini — see its use
  // below for why it's gated on ocrText existing.
  const GROQ_API_KEY = process.env.GROQ_API_KEY;

  if (!LOVABLE_API_KEY && !GEMINI_API_KEY) {
    console.error("[extract-core] Both LOVABLE_API_KEY and GEMINI_API_KEY are missing in the server runtime");
    return { ok: false, error: "AI not configured" };
  }

  const { data: extraction, error: fetchErr } = await supabase
    .from("extractions")
    .select("*")
    .eq("id", extractionId)
    .single();

  if (fetchErr || !extraction) return { ok: false, error: "not_found" };

  // Atomic claim: only a row still in "pending" or "failed" (a retry) can be
  // taken. Without the status filter here, two concurrent callers for the same
  // row (two open tabs, the auto-redrive path racing the direct-processing
  // effect, a durable worker racing this page) would BOTH pass, both run a
  // full OCR+AI cycle, and both write a result — confirmed happening in
  // production logs as the same extraction_id logging "Template match" twice
  // back to back. The caller-side code already expects an "already_processing"
  // result and treats it as a harmless no-op (see queue.functions.ts and
  // batches.$id.tsx) — this was the missing half of that contract.
  // A deadlocked claim, if not retried, surfaced as "claim_failed", which the
  // caller does not treat as retryable (unlike "already_processing"), leaving
  // a perfectly good "pending" row stuck for the rest of the page's life.
  const { data: claimed, error: claimErr } = await retryOnDeadlock(
    () =>
      supabase
        .from("extractions")
        .update({ status: "processing", error_message: "Reading screenshot...", updated_at: nowIso() })
        .eq("id", extractionId)
        .in("status", ["pending", "failed"])
        .select("id"),
    `Claim for ${extractionId}`,
  );

  if (claimErr) {
    console.error("[extract-core] Could not claim extraction:", claimErr.message);
    return { ok: false, error: "claim_failed" };
  }
  if (!claimed?.length) {
    // Someone else already claimed this row (or it's already done/cancelled).
    // Not this row's failure — leave its status exactly as the actual claimant
    // left it rather than touching it.
    return { ok: false, error: "already_processing" };
  }

  // OCR is the primary reader. When it cannot answer, the screenshot goes to the
  // model directly rather than the row failing: the OCR service runs inference
  // that costs gigabytes per page, so on a small host it is the part most likely
  // to be unavailable, and a transcript is not the only way to read a receipt.
  let imageDataUrl: string;
  let mimeType = "image/png";
  let imageBytes: Buffer;

  try {
    const { data: imgData, error: downloadErr } = await supabase.storage
      .from("screenshots")
      .download(extraction.storage_path);

    if (downloadErr || !imgData) {
      throw new Error(`Failed to download image from storage: ${downloadErr?.message || "Unknown error"}`);
    }

    const bytes = Buffer.from(await imgData.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new Error(`Image is ${Math.round(bytes.length / 1024 / 1024)}MB, over the ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit`);
    }

    imageBytes = bytes;
    mimeType = imgData.type || "image/png";
    imageDataUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;
  } catch (err: any) {
    console.error("[extract-core] Could not read screenshot:", err.message, "| cause:", err.cause);
    await supabase.from("extractions").update({
      status: "failed",
      error_message: `Could not read screenshot: ${err.message}`.slice(0, 500),
      updated_at: nowIso(),
    }).eq("id", extraction.id);
    await syncBatchCounts(supabase, extraction.batch_id);
    return { ok: false, error: "image_unavailable" };
  }

  const ocrResult = await readWithOcr(imageBytes, mimeType, extraction.file_name);
  const ocrText = ocrResult?.text ?? null;

  // Fast path: the client's own rendered order page is a fixed, known layout
  // (see src/lib/template-extract.ts). When it matches with high confidence,
  // this skips the AI call entirely — the whole reason OCR is the primary
  // path at all is that the AI call is the expensive part.
  if (ocrResult) {
    const templateResult = tryTemplateExtraction(ocrResult.text, ocrResult.confidence);
    if (templateResult) {
      const templateEnabled = (process.env.TEMPLATE_EXTRACTION_ENABLED ?? "false").toLowerCase() === "true";
      if (templateEnabled) {
        console.log(`[extract-core] Template match for ${extraction.id} — skipping AI`);
        return await finalizeExtraction(supabase, extraction, templateResult.data, templateResult.confidence, "template", true);
      }
      // Shadow mode: log what the template path would have returned, then
      // fall through to the real (Gemini) path below unchanged, so the two
      // can be compared per-row before TEMPLATE_EXTRACTION_ENABLED is flipped on.
      console.log(`[extract-core] [shadow] template would match for ${extraction.id}:`, JSON.stringify(templateResult.data));
    }
  }

  const userContent = ocrText
    ? [
        {
          type: "text" as const,
          text: `Extract all telecom order fields from the OCR text below. Return JSON only.
===== OCR TEXT =====
${ocrText}
===== END OCR TEXT =====`,
        },
      ]
    : [
        {
          type: "text" as const,
          text: "Extract all telecom order fields from this order screenshot. Return JSON only.",
        },
        {
          type: "image_url" as const,
          image_url: { url: imageDataUrl },
        },
      ];

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  const callGateway = () => fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Lovable-API-Key": LOVABLE_API_KEY || "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3.6-flash", // gemini-2.0-flash was retired by Google; 3.6 is the current stable flash model
      messages,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });

  let aiRes: Response | undefined;
  let provider: "groq" | "gemini" | "gateway" = "gateway";
  let directErrBody = "";

  // Groq is free and fast, but text-only (no vision endpoint used here) — so
  // it's only worth trying when OCR already gave us text to extract from.
  // The image-fallback case (ocrText null, OCR was unavailable) always goes
  // straight to Gemini/gateway below, unchanged. A Groq failure here just
  // falls through to that same chain rather than failing the row.
  if (ocrText && GROQ_API_KEY) {
    provider = "groq";
    try {
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          // This account's available model list has no classic llama-3.x
          // chat model (confirmed via GET /openai/v1/models) — gpt-oss-120b
          // is the general-purpose text model actually on it. Re-check that
          // endpoint before changing this again rather than guessing a name.
          model: "openai/gpt-oss-120b",
          messages,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
      if (groqRes.ok) {
        aiRes = groqRes;
      } else {
        directErrBody = (await groqRes.text().catch(() => "")).slice(0, 500);
        console.error(`[extract-core] Groq failed ${groqRes.status}: ${directErrBody}`);
      }
    } catch (e: any) {
      console.error("[extract-core] Groq threw:", e?.message);
      directErrBody = e?.message ?? "network error";
    }
  }

  if (!aiRes) {
    if (GEMINI_API_KEY) {
      provider = "gemini";
      try {
        aiRes = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gemini-3.6-flash",
            messages,
            response_format: { type: "json_object" },
          }),
          signal: AbortSignal.timeout(AI_TIMEOUT_MS),
        });
        if (!aiRes.ok) {
          directErrBody = (await aiRes.text().catch(() => "")).slice(0, 500);
          console.error(`[extract-core] Gemini direct failed ${aiRes.status}: ${directErrBody}`);
          if (LOVABLE_API_KEY) {
            provider = "gateway";
            aiRes = await callGateway();
          }
        }
      } catch (e: any) {
        console.error("[extract-core] Gemini direct threw:", e?.message);
        directErrBody = e?.message ?? "network error";
        if (!LOVABLE_API_KEY) {
          await supabase.from("extractions").update({
            status: "pending",
            error_message: `AI request failed: ${directErrBody}`.slice(0, 500),
            updated_at: nowIso(),
          }).eq("id", extraction.id);
          await syncBatchCounts(supabase, extraction.batch_id);
          return { ok: false, error: "ai_error" };
        }
        provider = "gateway";
        aiRes = await callGateway();
      }
    } else {
      provider = "gateway";
      aiRes = await callGateway();
    }
  }

  if (!aiRes.ok) {
    const body = (await aiRes.text().catch(() => "")).slice(0, 500);
    // 429 = rate limit, 402 = out of credits, 5xx = transient -> keep retryable.
    const retryable = aiRes.status >= 500 || aiRes.status === 429 || aiRes.status === 402;
    const status = retryable ? "pending" : "failed";
    const detail = body || directErrBody || aiRes.statusText;
    console.error(`[extract-core] AI error via ${provider} ${aiRes.status}: ${detail}`);
    await supabase.from("extractions").update({
      status,
      error_message: `AI error (${provider} ${aiRes.status}): ${detail}`.slice(0, 500),
      updated_at: nowIso(),
    }).eq("id", extraction.id);
    await syncBatchCounts(supabase, extraction.batch_id);
    return { ok: false, error: "ai_error" };
  }

  const aiJson: any = await aiRes.json().catch(() => ({}));
  const content = aiJson?.choices?.[0]?.message?.content ?? "{}";
  let parsed: any;
  try {
    parsed = ExtractionSchema.parse(JSON.parse(content));
  } catch (e: any) {
    console.error(`[extract-core] Invalid AI response via ${provider}:`, String(content).slice(0, 300));
    await supabase.from("extractions").update({
      status: "failed",
      error_message: `Invalid AI response schema: ${String(e?.message ?? "parse error")}`.slice(0, 500),
      updated_at: nowIso(),
    }).eq("id", extraction.id);
    await syncBatchCounts(supabase, extraction.batch_id);
    return { ok: false, error: "validation_failed" };
  }

  let data = parsed.data || {};
  let confidence = parsed.confidence || {};

  // A schema-valid response with every field null is not a real extraction —
  // confirmed happening for real under concurrent OCR load: OCR returned text
  // (ocrUsed: true) but that text was apparently unusable, Groq correctly
  // found nothing in it, and the row still landed as "success" with a blank
  // row in the UI (raw_response.confidence was even `{}`). If the miss came
  // from the text-only Groq path, the image itself hasn't been tried yet —
  // give it one real second chance via Gemini vision, bypassing whatever was
  // wrong with the OCR text entirely, before accepting the empty result.
  const hasCoreFields = (d: Record<string, any>) => Boolean(d.order_number || d.customer_name || d.phone_number);
  if (!hasCoreFields(data) && provider === "groq" && GEMINI_API_KEY) {
    console.warn(`[extract-core] Groq returned no extractable fields for ${extraction.id} — retrying via Gemini vision`);
    try {
      const visionMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text" as const, text: "Extract all telecom order fields from this order screenshot. Return JSON only." },
            { type: "image_url" as const, image_url: { url: imageDataUrl } },
          ],
        },
      ];
      const retryRes = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gemini-3.6-flash", messages: visionMessages, response_format: { type: "json_object" } }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
      if (retryRes.ok) {
        const retryJson: any = await retryRes.json().catch(() => ({}));
        const retryContent = retryJson?.choices?.[0]?.message?.content ?? "{}";
        const retryParsed = ExtractionSchema.parse(JSON.parse(retryContent));
        const retryData = retryParsed.data || {};
        if (hasCoreFields(retryData)) {
          data = retryData;
          confidence = retryParsed.confidence || {};
          provider = "gemini";
          console.log(`[extract-core] Gemini vision retry recovered fields for ${extraction.id}`);
        }
      }
    } catch (e: any) {
      console.warn(`[extract-core] Gemini vision retry failed for ${extraction.id}:`, e?.message);
      // Falls through with the original empty result — finalizeExtraction's
      // own hasCoreFields check below still forces needs_review either way.
    }
  }

  return await finalizeExtraction(supabase, extraction, data, confidence, provider, Boolean(ocrResult));
}

/**
 * Shared tail for both extraction paths (template match and AI): normalizes
 * fields, applies batch defaults, checks for duplicate order numbers, and
 * writes the result. `source` is stored in raw_response so the
 * template/groq/gemini/gateway split is queryable later
 * (`raw_response->>'source'`) — the cheapest signal for noticing the
 * client's page layout has drifted (template match rate would drop), or for
 * checking how much load Groq is actually taking off Gemini, without adding
 * a migration. Previously this was hardcoded to "gemini" for every non-
 * template row regardless of which provider actually answered (a leftover
 * from before Groq/the gateway existed as alternatives) — now it carries the
 * real `provider` value from the AI call site.
 *
 * `ocrUsed` records whether the OCR service actually answered for this row
 * (vs. the screenshot going straight to the model because OCR was
 * unavailable). Before this, that fact only ever reached a server
 * `console.warn` — a row that succeeded looked identical in the UI whether
 * OCR helped or not, so a pattern of "OCR keeps failing under load" was only
 * diagnosable by reading server logs. batches.$id.tsx's StatusBadge reads
 * this off a successful row to show a small "No OCR" marker instead.
 */
async function finalizeExtraction(
  supabase: SB,
  extraction: any,
  data: Record<string, any>,
  confidence: Record<string, number>,
  source: "template" | "groq" | "gemini" | "gateway",
  ocrUsed: boolean,
): Promise<RunExtractionResult> {
  const update: Record<string, any> = {
    status: "success",
    confidence,
    avg_confidence: avgConfidence(confidence),
    raw_response: { source, data, confidence, ocrUsed } as any,
    error_message: null,
    // No processing_completed_at column exists on extractions; updated_at is
    // what actually records when the row reached this state.
    updated_at: nowIso(),
  };

  for (const f of EXTRACT_FIELDS) update[f] = data[f] ?? null;
  update.phone_number = normalizePhone(data.phone_number);
  update.cnic = normalizeCnic(data.cnic);

  const { data: batchRow } = await supabase.from("batches").select("default_store_id, default_employee_name, default_branch_name").eq("id", extraction.batch_id).single();
  if (batchRow) {
    if (batchRow.default_store_id) update.store_id = batchRow.default_store_id;
    if (batchRow.default_employee_name) update.employee_name = batchRow.default_employee_name;
    if (batchRow.default_branch_name) update.branch_name = batchRow.default_branch_name;
  }

  // A schema-valid response with every core field null still writes "success"
  // by the checks above — confirmed happening for real (a row with every
  // field blank in the UI, raw_response.confidence: {}). Whatever the cause,
  // a row that identifies nothing is never a row staff should trust without
  // looking — force it into review rather than let it blend in as plain "OK".
  const noCoreFields = !data.order_number && !data.customer_name && !data.phone_number;
  update.needs_review = noCoreFields || Object.values(confidence).some((v: any) => typeof v === "number" && v < 90);
  if (noCoreFields) {
    console.warn(`[extract-core] ${extraction.id} has no order_number/customer_name/phone_number via ${source} — forcing needs_review`);
  }

  const incomingOrder = (data.order_number ?? "").toString().trim().toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
  if (incomingOrder) {
    const { data: match } = await supabase.from("extractions")
      .select("id")
      .eq("created_by", extraction.created_by)
      .eq("order_number_normalized" as any, incomingOrder)
      .neq("id", extraction.id)
      .eq("is_duplicate", false)
      .maybeSingle();
    if (match) {
      update.is_duplicate = true;
      update.duplicate_of = match.id;
    }
  }

  let { data: writtenRows, error: writeErr } = await retryOnDeadlock(
    () => supabase.from("extractions").update(update as any).eq("id", extraction.id).select("id"),
    `Save result for ${extraction.id}`,
  );

  // A column the deployment's schema does not have yet (e.g. alternative_contact
  // before its migration ran) rejects the whole update. Drop it and retry once
  // rather than failing a row over an optional field.
  if (writeErr) {
    const missing = /column "?([a-z_]+)"? .*does not exist|Could not find the '([a-z_]+)' column/i.exec(writeErr.message);
    const col = missing?.[1] ?? missing?.[2];
    if (col && col in update) {
      console.warn(`[extract-core] Column "${col}" missing in schema — retrying without it.`);
      delete update[col];
      const retry = await retryOnDeadlock(
        () => supabase.from("extractions").update(update as any).eq("id", extraction.id).select("id"),
        `Save result for ${extraction.id} (retry without missing column)`,
      );
      writtenRows = retry.data;
      writeErr = retry.error;
    }
  }

  // Reporting success for a result that was never stored would leave the row
  // queued forever while the batch counted it as done.
  if (writeErr || !writtenRows?.length) {
    const reason = writeErr?.message ?? "no rows matched";
    console.error("[extract-core] Could not save extracted fields:", reason);
    await supabase
      .from("extractions")
      .update({ status: "failed", error_message: `Could not save result: ${reason}`.slice(0, 500), updated_at: nowIso() })
      .eq("id", extraction.id);
    await syncBatchCounts(supabase, extraction.batch_id);
    return { ok: false, error: "save_failed" };
  }

  await syncBatchCounts(supabase, extraction.batch_id);

  return { ok: true, extraction_id: extraction.id };
}
