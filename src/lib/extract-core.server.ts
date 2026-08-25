// Core AI extraction routine. Callable from an auth-verified route or from a
// background Inngest worker. Uses the admin client so it works without a user
// session; the caller is responsible for authorizing the request first.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { normalizePhone, normalizeCnic, avgConfidence, EXTRACT_FIELDS } from "@/lib/format";
import { z } from "zod";

const SYSTEM_PROMPT = `You are an expert at extracting structured data from telecom order screenshots (WhatsApp, POS, CRM). Extract every field you can find. If a field is missing, use null. Look carefully — labels may vary (e.g. "MSISDN"/"Mobile"/"Onic Number" all mean phone_number). Return ONLY valid JSON matching this exact schema:

{
  "data": {
    "customer_name": string|null,
    "phone_number": string|null,
    "current_network": string|null,
    "sim_type": string|null,
    "number_type": string|null,
    "package_name": string|null,
    "number_charges": string|null,
    "paid_via": string|null,
    "discount": string|null,
    "email": string|null,
    "store_id": string|null,
    "reference": string|null,
    "deposit": string|null,
    "remaining_deposit": string|null,
    "order_number": string|null,
    "cnic": string|null,
    "plan_price": string|null,
    "activation_date": string|null,
    "activation_time": string|null,
    "employee_name": string|null,
    "branch_name": string|null,
    "order_status": string|null,
    "remarks": string|null
  },
  "confidence": {
    "<field_name>": number (0-100)
  }
}

Field hints:
- sim_type: physical SIM type (e.g. "eSIM", "Physical", "Regular")
- number_type: category of the number (e.g. "Golden", "Silver", "Normal", "VIP", "Premium")
- package_name: the plan/package name (e.g. "Onic Ultra 1500", "Postpaid 2000") — NOT the price
- plan_price: the price/tariff amount only

CRITICAL ACCURACY RULES — read every character twice before committing:
1. Character disambiguation: In alphanumeric codes (order_number, reference, store_id) distinguish carefully:
   - digit 0 (zero, narrower, often has slash/dot) vs letter O (rounder, wider)
   - digit 1 vs letter I vs letter l vs letter |
   - digit 5 vs letter S, digit 8 vs letter B, digit 2 vs letter Z, digit 6 vs letter G
   Match the surrounding pattern: if the code is "CXO-XXXXXXXXXXXXX" and other chars are letters, that middle char is likely a letter too; if it's a run of digits, it's a digit. Never guess — if a single character is ambiguous, set that field's confidence below 85.
2. Numeric fields (phone_number, cnic, plan_price, deposit, charges): every character MUST be a digit 0-9 (plus separators). If you see O/I/l/S/B in these, they are almost certainly 0/1/1/5/8. Convert them.
3. Phone numbers: Pakistan mobile format is 11 digits starting 03XX (e.g. 03001234567). CNIC is 13 digits, often shown as XXXXX-XXXXXXX-X.
4. Confidence scoring — be honest, not optimistic:
   - 95-100: crystal clear, every char unambiguous
   - 85-94: readable but one char slightly ambiguous
   - 70-84: partially blurred / cropped / a couple of ambiguous chars
   - below 70: return null instead — do not guess
5. If the screenshot is blurry, cropped, or you cannot clearly read a field, set it to null. A null is better than a wrong value.

Only include confidence entries for fields you actually extracted (non-null). Do not wrap in markdown code fences.`;

type SB = SupabaseClient<Database>;

const STALE_PROCESSING_MS = 2 * 60_000;

function nowIso() {
  return new Date().toISOString();
}

function isStaleProcessing(updatedAt: unknown) {
  const updatedAtMs = Date.parse(String(updatedAt ?? ""));
  return !Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > STALE_PROCESSING_MS;
}

const ExtractionSchema = z.object({
  data: z.record(z.string().nullable()),
  confidence: z.record(z.number()),
});

export type RunExtractionResult =
  | { ok: true; extraction_id: string }
  | { ok: false; error: string };

async function syncBatchCounts(supabase: SB, batchId: string) {
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

  await supabase
    .from("batches")
    .update({
      processed_count: processed,
      failed_count: failed,
      duplicate_count: dups,
      status: nextStatus,
      updated_at: nowIso(),
    })
    .eq("id", batchId);

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

// How often a row being actively worked on republishes its updated_at. Must stay
// comfortably under the staleness cutoff used by requeueStaleExtractions
// (2 minutes) so a slow-but-healthy job is never mistaken for a dead one.
const HEARTBEAT_INTERVAL_MS = 30_000;

// Upper bound on a single OCR call. Generous enough for a dense screenshot on a
// small CPU-only host, short enough that a wedged worker surfaces as a failure
// instead of a request that never returns.
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS) || 120_000;

// Same reasoning for the AI provider call.
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 90_000;

/**
 * Runs an extraction, keeping the row's updated_at fresh for as long as the work
 * is actually in flight.
 *
 * Without this, any worker watching for stale jobs (ours or another deployment
 * pointed at the same database) sees a row whose OCR simply takes longer than
 * the staleness cutoff, assumes the job died, and requeues it — so two workers
 * end up racing over one row and the slower-but-correct result loses.
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
  const OCR_URL = process.env.OCR_URL;
  const OCR_API_KEY = process.env.OCR_API_KEY;

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

  let ocrText = ((extraction as any).ocr_text || "").trim();

  // If OCR text is missing, attempt to call the OCR service
  if (!ocrText) {
    if (!OCR_URL) {
      console.error("[extract-core] OCR_URL is missing and extraction row has no ocr_text");
      await supabase.from("extractions").update({
        status: "failed",
        error_message: "OCR service not configured and no OCR text provided.",
        updated_at: nowIso(),
      }).eq("id", extraction.id);
      await syncBatchCounts(supabase, extraction.batch_id);
      return { ok: false, error: "no_ocr_config" };
    }

    try {
      await supabase.from("extractions").update({ status: "processing", error_message: "Calling OCR service...", updated_at: nowIso() }).eq("id", extractionId);

      const { data: imgData, error: downloadErr } = await supabase.storage
        .from("screenshots")
        .download(extraction.storage_path);

      if (downloadErr || !imgData) {
        throw new Error(`Failed to download image from storage: ${downloadErr?.message || "Unknown error"}`);
      }

      const formData = new FormData();
      formData.append("file", new Blob([imgData], { type: imgData.type || "image/jpeg" }), extraction.file_name || "image.jpg");

      const baseUrl = OCR_URL.replace(/\/+$/, "");
      // Log both potential endpoints to help debugging
      const targetUrl = `${baseUrl}/ocr/upload`;
      const ocrStartedAt = Date.now();
      console.log(
        `[extract-core] OCR request -> ${targetUrl} (bytes=${(imgData as any).size}, type=${(imgData as any).type})`,
      );
      // Without a deadline a stalled OCR worker holds the request open forever,
      // leaving the row in "processing" until something else times it out.
      const ocrRes = await fetch(targetUrl, {
        method: "POST",
        headers: OCR_API_KEY ? { "X-API-Key": OCR_API_KEY } : {},
        body: formData,
        signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
      });
      console.log(`[extract-core] OCR responded ${ocrRes.status} in ${Date.now() - ocrStartedAt}ms`);

      if (!ocrRes.ok) {
        const ocrErrBody = await ocrRes.text().catch(() => "Unknown OCR error");
        throw new Error(`OCR service failed (${ocrRes.status}): ${ocrErrBody.slice(0, 200)}`);
      }

      const ocrJson: any = await ocrRes.json();
      ocrText = (ocrJson.text || "").trim();

      if (!ocrText) {
        throw new Error("OCR service returned empty text for this image.");
      }

      // Save OCR text for future use/retries
      await supabase.from("extractions").update({
        ocr_text: ocrText,
        status: "ocr_completed",
        updated_at: nowIso(),
      } as any).eq("id", extraction.id);

    } catch (err: any) {
      console.error("[extract-core] OCR step failed:", err.message, "| cause:", err.cause);
      await supabase.from("extractions").update({
        status: "failed",
        error_message: `OCR failed: ${err.message}`.slice(0, 500),
        updated_at: nowIso(),
      }).eq("id", extraction.id);
      await syncBatchCounts(supabase, extraction.batch_id);
      return { ok: false, error: "ocr_failed" };
    }
  }

  const userContent = [{
    type: "text" as const,
    text: `Extract all telecom order fields from the OCR text below. Return JSON only.
===== OCR TEXT =====
${ocrText}
===== END OCR TEXT =====`
  }];

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

  let aiRes: Response;
  let provider = "gateway";
  let directErrBody = "";

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
    aiRes = await callGateway();
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

  const data = parsed.data || {};
  const confidence = parsed.confidence || {};
  
  const update: Record<string, any> = {
    status: "success",
    confidence,
    avg_confidence: avgConfidence(confidence),
    raw_response: parsed as any,
    error_message: null,
    processing_completed_at: nowIso(),
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

  update.needs_review = Object.values(confidence).some((v: any) => typeof v === "number" && v < 90);
  
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

  await supabase.from("extractions").update(update as any).eq("id", extraction.id);
  await syncBatchCounts(supabase, extraction.batch_id);

  return { ok: true, extraction_id: extraction.id };
}
