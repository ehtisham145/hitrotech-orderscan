import { createFileRoute, Link } from "@tanstack/react-router";
import { confirmDialog } from "@/components/ConfirmDialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/ext-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Download, RefreshCw, Eye, Trash2, CheckCheck, PlayCircle, PauseCircle, XCircle, FileText, Search } from "lucide-react";
import { toast } from "sonner";
import { EXTRACT_FIELDS, FIELD_LABELS, type ExtractField } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ConfidenceDot } from "@/components/ConfidenceDot";
import { StatusBadge } from "@/components/StatusBadge";
import { SortableTh } from "@/components/SortableTh";
import { FilterSelect } from "@/components/FilterSelect";
import { EditableCell } from "@/components/EditableCell";
import { useServerFn } from "@tanstack/react-start";
import { keepBatchRowsFresh, processExtractionNow, queueExtractions } from "@/lib/queue.functions";

const filterSchema = z.object({
  status: fallback(z.string(), "all").default("all"),
  review: fallback(z.string(), "all").default("all"),
  dup: fallback(z.string(), "all").default("all"),
  network: fallback(z.string(), "").default(""),
  branch: fallback(z.string(), "").default(""),
  page: fallback(z.number().int(), 1).default(1),
});

const PAGE_SIZE = 100;
const STALE_PROCESSING_MS = 2 * 60_000;
// Keeps queued rows from ageing past the staleness cutoff while this page is
// driving the batch. Comfortably under STALE_PROCESSING_MS.
const QUEUE_HEARTBEAT_MS = 30_000;
// A row that keeps coming back failed is not making progress; stop re-driving
// it and leave it for a human rather than looping.
const MAX_AUTO_RETRIES_PER_ROW = 3;

function isRecoverableQueueFailure(message: string | null | undefined) {
  return /AI not configured|Failed to fetch|Queue failed|Background queue|AI rate limit|retrying automatically|Waiting for AI capacity|Processing directly|already_processing|already_claimed|proxy_/i.test(message ?? "");
}

/**
 * Failures that came from a worker configured differently to this one — a
 * retired AI model, or an OCR endpoint this deployment no longer points at.
 * The row itself is fine; whichever worker claimed it was running stale
 * config, so re-driving it here is worth a few attempts.
 */
function isForeignWorkerFailure(message: string | null | undefined) {
  return /OCR service failed \(503\)|no longer available|models\/gemini-2\.0/i.test(message ?? "");
}

function isStaleProcessingRow(row: { status: string; updated_at?: string | null }) {
  const updatedAtMs = Date.parse(String(row.updated_at ?? ""));
  return row.status === "processing" && (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > STALE_PROCESSING_MS);
}

/** A failed row worth re-driving automatically rather than leaving for a human. */
function isRedrivableFailure(
  row: { status: string; id: string; error_message?: string | null },
  autoRetryCounts: Map<string, number>,
) {
  return (
    row.status === "failed" &&
    (isRecoverableQueueFailure(row.error_message) ||
      (isForeignWorkerFailure(row.error_message) && (autoRetryCounts.get(row.id) ?? 0) < MAX_AUTO_RETRIES_PER_ROW))
  );
}

type ClaimableRow = { id: string; status: string; error_message?: string | null; updated_at?: string | null };
type ClaimableBatch = { status: string } | null | undefined;

/**
 * Whether the batch itself is in a state where new claims should even be
 * attempted — independent of whether any individual row looks eligible.
 *
 * Pulled out as its own function (rather than living inline in claimNext())
 * after a real production freeze: stillHasClaimableWork() checked row
 * eligibility only, without this batch-level gate, while claimNext() checked
 * both. For any paused/cancelled batch that still had a genuinely "pending"
 * row (completely normal — that's what pausing mid-batch looks like),
 * claimNext() correctly refused every claim while stillHasClaimableWork()
 * kept saying yes — spinning the direct-processing effect's wave loop
 * forever with no real async work in it, pegging a CPU core and freezing the
 * tab. Sharing one function for both closes the gap for good instead of
 * just patching this one instance of it.
 */
function canClaimFromBatch(batch: ClaimableBatch, rows: ClaimableRow[] | null | undefined, autoRetryCounts: Map<string, number>) {
  if (!batch) return false;
  if (batch.status === "paused" || batch.status === "cancelled") return false;
  if (batch.status === "completed") {
    const hasRecoverableFailures = rows?.some((r) => isRedrivableFailure(r, autoRetryCounts)) ?? false;
    if (!hasRecoverableFailures) return false;
  }
  return true;
}

/** Same row-eligibility rule shared by hasClaimableWork/claimNext/stillHasClaimableWork. */
function isEligibleRow(
  row: ClaimableRow,
  browserProcessedIds: Set<string>,
  directRetryAfter: Map<string, number>,
  autoRetryCounts: Map<string, number>,
  now: number,
) {
  return (
    (row.status === "pending" || isRedrivableFailure(row, autoRetryCounts)) &&
    !isStaleProcessingRow(row) &&
    !browserProcessedIds.has(row.id) &&
    (directRetryAfter.get(row.id) ?? 0) <= now
  );
}

export const Route = createFileRoute("/_authenticated/batches/$id")({
  validateSearch: zodValidator(filterSchema),
  head: () => ({
    meta: [
      { title: "Batch details — HitroTech OrderScan" },
      { name: "description", content: "Review extracted rows, fix mistakes, resolve duplicates, and export a single batch." },
      { property: "og:title", content: "Batch details — HitroTech OrderScan" },
      { property: "og:description", content: "Review extracted rows, fix mistakes, resolve duplicates, and export a single batch." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BatchDetail,
});

function BatchDetail() {
  const { id } = Route.useParams();
  const filters = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const queueExtractionsFn = useServerFn(queueExtractions);
  const processExtractionNowFn = useServerFn(processExtractionNow);
  const keepBatchRowsFreshFn = useServerFn(keepBatchRowsFresh);
  const [viewingPath, setViewingPath] = useState<string | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queueRunning, setQueueRunning] = useState(false);
  const autoQueueKeys = useRef<Map<string, number>>(new Map());
  const browserProcessing = useRef(false);
  const browserProcessedIds = useRef<Set<string>>(new Set());
  const directRetryAfter = useRef<Map<string, number>>(new Map());
  const autoRetryCounts = useRef<Map<string, number>>(new Map());

  const { data: batch } = useQuery({
    queryKey: ["batch", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("batches").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
    refetchInterval: (q) => (q.state.data?.status === "processing" || q.state.data?.status === "uploading" ? 1000 : false),
  });

  const { data: rows } = useQuery({
    queryKey: ["extractions", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("extractions")
        .select("*")
        .eq("batch_id", id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    refetchInterval: (q) => {
      const rows = q.state.data as { status: string }[] | undefined;
      return rows?.some((r) => r.status === "pending" || r.status === "processing") ? 1000 : false;
    },
  });

  // Mirrors of the latest query data for the direct-processing effect below to
  // read from a live worker loop without needing `rows`/`batch` themselves in
  // its dependency array — see that effect's comment for why that matters.
  const rowsRef = useRef(rows);
  const batchRef = useRef(batch);

  useEffect(() => {
    if (!viewingPath) {
      setImgUrl(null);
      return;
    }
    supabase.storage.from("screenshots").createSignedUrl(viewingPath, 300).then(({ data }) => {
      setImgUrl(data?.signedUrl ?? null);
    });
  }, [viewingPath]);

  // Real-time updates: subscribe to changes on this batch's extractions and
  // batch row so progress reflects instantly without a manual refresh.
  useEffect(() => {
    const channel = supabase
      .channel(`batch-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "extractions", filter: `batch_id=eq.${id}` },
        () => {
          qc.invalidateQueries({ queryKey: ["extractions", id] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "batches", filter: `id=eq.${id}` },
        () => {
          qc.invalidateQueries({ queryKey: ["batch", id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, qc]);

  const runQueue = useCallback(
    async (ids: string[], mode: "auto" | "manual" = "manual") => {
      if (ids.length === 0 || queueRunning) return;
      // Any explicit (re)queue — the Retry button, "Requeue failed", bulk
      // re-queue, or Start/Resume picking up recoverable failures — means
      // "give this row a fresh attempt" regardless of whatever the
      // direct-processing effect remembers about it. Without clearing these,
      // a row whose earlier failure didn't match the auto-retry patterns
      // below would go back to "pending" here but then never actually get
      // reprocessed: browserProcessedIds marks it claimed for the rest of
      // the page's life once claimNext() has ever picked it up, so the
      // direct-processing effect would silently skip it forever, leaving it
      // stuck at "pending" until a full page reload.
      for (const rowId of ids) {
        browserProcessedIds.current.delete(rowId);
        directRetryAfter.current.delete(rowId);
      }
      setQueueRunning(true);
      try {
        const res = await queueExtractionsFn({ data: { extraction_ids: ids } });
        const queued = res.queued ?? 0;
        if (queued > 0 && mode === "manual") toast.success(`Queued ${queued}`, { id: `queue-success-${id}` });
        if ((res.failed_to_queue ?? 0) > 0 && mode === "manual") {
          toast.warning(`${res.failed_to_queue} image${res.failed_to_queue === 1 ? "" : "s"} will process directly on this page`, {
            id: `queue-partial-${id}`,
          });
        }
      } catch (err) {
        if (mode === "manual") toast.error("Processing failed to start", { id: `queue-failed-${id}` });
        console.error(err);
      } finally {
        setQueueRunning(false);
        qc.invalidateQueries({ queryKey: ["extractions", id] });
        qc.invalidateQueries({ queryKey: ["batch", id] });
      }
    },
    [id, qc, queueExtractionsFn, queueRunning],
  );

  // Auto-process any pending rows so images don't get stuck after upload,
  // reload, or navigation. Pause/cancel stop this from launching new work.
  useEffect(() => {
    if (!batch || !rows || queueRunning) return;
    if (batch.status === "paused" || batch.status === "cancelled" || batch.status === "completed") return;
    const now = Date.now();
    const pending = rows
      .filter(
        (r) =>
          r.status === "pending" || isStaleProcessingRow(r),
      )
      .map((r) => r.id);
    if (pending.length === 0) return;
    const autoKey = pending.slice().sort().join("|");
    const lastRun = autoQueueKeys.current.get(autoKey) ?? 0;
    if (now - lastRun < 5_000) return;
    autoQueueKeys.current.set(autoKey, now);
    void runQueue(pending, "auto");
  }, [batch, queueRunning, rows, runQueue]);

  // Keep this batch's queued rows from ageing into the staleness cutoff while
  // we are the ones working through them — a row waiting its turn behind a long
  // batch is otherwise indistinguishable from an abandoned job, and gets
  // requeued out from under us.
  // Depends on booleans, not on `batch`/`rows` themselves: those are new objects
  // on every poll, and re-running the effect that often would clear the interval
  // before it ever reached its first tick.
  const batchIsWorking = Boolean(
    batch && batch.status !== "paused" && batch.status !== "cancelled" && batch.status !== "completed",
  );
  const hasQueuedRows = Boolean(rows?.some((r) => r.status === "pending"));

  useEffect(() => {
    if (!batchIsWorking || !hasQueuedRows) return;

    const tick = () => {
      void keepBatchRowsFreshFn({ data: { batch_id: id } }).catch(() => {
        // Best-effort: a missed beat just means the next one covers it.
      });
    };
    const timer = setInterval(tick, QUEUE_HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [batchIsWorking, hasQueuedRows, id, keepBatchRowsFreshFn]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  useEffect(() => {
    batchRef.current = batch;
  }, [batch]);

  // Safety net: process queued rows directly from the open batch page without
  // showing per-image popups. The server still claims each row atomically, so
  // this does not duplicate work if the durable background worker also starts.
  //
  // Depends on a boolean, not on `rows`/`batch` themselves — same reasoning as
  // the heartbeat effect above, but the stakes here are higher: this effect's
  // cleanup tears down an in-flight worker pool, and `rows` gets a new object
  // reference on every ~1s poll and every realtime update. With `rows` in the
  // dependency list, a bulk batch of N images reliably only ever got as far as
  // its first MAX_PARALLEL_WORKERS rows — the wave was marking every row it
  // *intended* to process as claimed up front, then getting torn down by the
  // very first row to finish (which invalidates the query, changing `rows`)
  // before the remaining cursor positions were ever dispatched. Those
  // abandoned rows stayed marked "claimed" for the rest of the page's life,
  // sitting at "pending" until a manual reload cleared `browserProcessedIds`.
  // The fix: react only to whether claimable work exists at all, and have
  // each worker pull its next row fresh off `rowsRef`/`batchRef` instead of a
  // snapshot frozen at wave-start — so an unrelated re-render can no longer
  // starve rows that are still waiting for a worker.
  const hasClaimableWork = Boolean(
    canClaimFromBatch(batch, rows, autoRetryCounts.current) &&
      rows?.some((r) => isEligibleRow(r, browserProcessedIds.current, directRetryAfter.current, autoRetryCounts.current, Date.now())),
  );

  useEffect(() => {
    if (!hasClaimableWork || browserProcessing.current) return;

    let cancelled = false;
    browserProcessing.current = true;

    const claimNext = (): string | null => {
      const currentBatch = batchRef.current;
      const currentRows = rowsRef.current;
      if (!currentRows || !canClaimFromBatch(currentBatch, currentRows, autoRetryCounts.current)) return null;

      const now = Date.now();
      const row = currentRows.find((r) => isEligibleRow(r, browserProcessedIds.current, directRetryAfter.current, autoRetryCounts.current, now));
      if (!row) return null;
      browserProcessedIds.current.add(row.id);
      if (row.status === "failed") {
        autoRetryCounts.current.set(row.id, (autoRetryCounts.current.get(row.id) ?? 0) + 1);
      }
      return row.id;
    };

    // Same eligibility check as claimNext(), without claiming — used only to
    // decide whether it's worth starting another wave. Kept as a separate
    // read-only pass (rather than reusing hasClaimableWork, which closes over
    // the `rows` from the render that started this effect) because this runs
    // *inside* the effect, potentially long after that render, and needs
    // rowsRef's current value instead. Shares canClaimFromBatch/isEligibleRow
    // with claimNext() so the two can never again disagree about whether a
    // paused/cancelled/completed batch still has anything worth claiming —
    // see canClaimFromBatch's own comment for what happened the one time
    // they did.
    const stillHasClaimableWork = (): boolean => {
      const currentRows = rowsRef.current;
      if (!canClaimFromBatch(batchRef.current, currentRows, autoRetryCounts.current)) return false;
      const now = Date.now();
      return Boolean(
        currentRows?.some((r) => isEligibleRow(r, browserProcessedIds.current, directRetryAfter.current, autoRetryCounts.current, now)),
      );
    };

    const worker = async () => {
      while (!cancelled) {
        const rowId = claimNext();
        if (!rowId) return;
        try {
          const result = await processExtractionNowFn({ data: { extraction_id: rowId } });
          const errMsg = result.error ?? "";
          if (!result.ok && !/paused|cancelled|already_success/i.test(errMsg)) {
            console.warn("[batch direct processing] extraction did not complete", errMsg);
            if (/AI not configured|AI rate limit|retrying|capacity|already_processing|already_claimed|claim_failed|proxy_/i.test(errMsg)) {
              browserProcessedIds.current.delete(rowId);
              directRetryAfter.current.set(rowId, Date.now() + 5_000);
            }
          }
        } catch (err) {
          console.error("[batch direct processing] failed", err);
        } finally {
          qc.invalidateQueries({ queryKey: ["extractions", id] });
          qc.invalidateQueries({ queryKey: ["batch", id] });
        }
      }
    };

    // Kept deliberately small: the OCR service processes one image at a time
    // (OCR_MAX_CONCURRENCY on a modest host), so a large worker pool here just
    // means most requests queue on the OCR side and burn their timeout budget
    // waiting instead of extracting. A smaller pool spreads the same work over
    // fewer simultaneous requests, which is lighter on both this server and OCR.
    // Extra workers beyond however much work actually exists just no-op via
    // claimNext() returning null immediately, so it's safe to always spin up
    // the full count rather than sizing it to a (now nonexistent) static list.
    const MAX_PARALLEL_WORKERS = 4;
    const runWave = () => Promise.all(Array.from({ length: MAX_PARALLEL_WORKERS }, () => worker()));

    void (async () => {
      await runWave();
      // A wave ends the instant every worker's claimNext() comes up empty.
      // hasClaimableWork (the effect's own dependency, above) would normally
      // be what starts the next wave — but it only retriggers this effect on
      // a false→true *transition*, and it never had a chance to observe
      // false in between if new work (e.g. another upload to this same open
      // page) lands in the brief window between this wave's last claim and
      // its Promise.all settling. Re-checking directly here, before handing
      // control back, closes that window instead of leaving newly-arrived
      // rows waiting for some unrelated future change to nudge the effect.
      while (!cancelled && stillHasClaimableWork()) {
        await runWave();
      }
      browserProcessing.current = false;
      qc.invalidateQueries({ queryKey: ["extractions", id] });
      qc.invalidateQueries({ queryKey: ["batch", id] });
    })();

    return () => {
      cancelled = true;
    };
  }, [hasClaimableWork, id, processExtractionNowFn, qc]);

  const activeCount = useMemo(
    () => (rows ?? []).filter((r) => r.status === "pending" || r.status === "processing").length,
    [rows],
  );
  const trulyActiveCount = useMemo(
    () => (rows ?? []).filter((r) => r.status === "pending" || (r.status === "processing" && !isStaleProcessingRow(r))).length,
    [rows],
  );
  const staleProcessingCount = useMemo(() => (rows ?? []).filter(isStaleProcessingRow).length, [rows]);
  const pendingCount = useMemo(() => (rows ?? []).filter((r) => r.status === "pending").length, [rows]);
  const pausedCount = useMemo(() => (rows ?? []).filter((r) => r.status === "paused").length, [rows]);
  const failedCount = useMemo(() => (rows ?? []).filter((r) => r.status === "failed").length, [rows]);
  const recoverableFailedCount = useMemo(
    () => (rows ?? []).filter((r) => r.status === "failed" && isRecoverableQueueFailure(r.error_message)).length,
    [rows],
  );
  const cancellableCount = useMemo(
    () => (rows ?? []).filter((r) => ["pending", "processing", "paused"].includes(r.status)).length,
    [rows],
  );

  async function startPending() {
    const ids = (rows ?? [])
      .filter(
        (r) =>
          r.status === "pending" ||
          isStaleProcessingRow(r) ||
          r.status === "paused" ||
          (r.status === "failed" && isRecoverableQueueFailure(r.error_message)),
      )
      .map((r) => r.id);
    if (ids.length === 0) return toast.info("Nothing to process");
    await runQueue(ids);
  }

  async function pauseProcessing() {
    const ids = (rows ?? []).filter((r) => r.status === "pending" || r.status === "processing").map((r) => r.id);
    if (ids.length > 0) await supabase.from("extractions").update({ status: "paused" }).in("id", ids);
    await supabase.from("batches").update({ status: "paused" }).eq("id", id);
    toast.info("Processing paused");
    qc.invalidateQueries({ queryKey: ["extractions", id] });
    qc.invalidateQueries({ queryKey: ["batch", id] });
  }

  async function cancelProcessing() {
    if (!(await confirmDialog({ title: "Cancel remaining processing?", description: "Rows already extracted will stay saved.", confirmLabel: "Cancel processing", destructive: true }))) return;
    const ids = (rows ?? []).filter((r) => ["pending", "processing", "paused"].includes(r.status)).map((r) => r.id);
    if (ids.length > 0) await supabase.from("extractions").update({ status: "cancelled", error_message: "Cancelled by user" }).in("id", ids);
    await supabase.from("batches").update({ status: "cancelled" }).eq("id", id);
    toast.info("Processing cancelled");
    qc.invalidateQueries({ queryKey: ["extractions", id] });
    qc.invalidateQueries({ queryKey: ["batch", id] });
  }

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  const filtered = useMemo(() => {
    const base = (rows ?? []).filter((r) => {
      if (filters.status !== "all" && r.status !== filters.status) return false;
      if (filters.review === "yes" && !r.needs_review) return false;
      if (filters.review === "no" && r.needs_review) return false;
      if (filters.dup === "yes" && !r.is_duplicate) return false;
      if (filters.dup === "no" && r.is_duplicate) return false;
      if (filters.network && !(r.current_network ?? "").toLowerCase().includes(filters.network.toLowerCase())) return false;
      if (filters.branch && !(r.branch_name ?? "").toLowerCase().includes(filters.branch.toLowerCase())) return false;
      return true;
    });
    if (!sortKey) return base;
    const sorted = [...base].sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey];
      const bv = (b as Record<string, unknown>)[sortKey];
      const as = av == null ? "" : String(av);
      const bs = bv == null ? "" : String(bv);
      return as.localeCompare(bs, undefined, { numeric: true, sensitivity: "base" });
    });
    return sortDir === "asc" ? sorted : sorted.reverse();
  }, [rows, filters, sortKey, sortDir]);

  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const pageNum = Math.min(Math.max(1, filters.page), totalPages);
  const pageStart = (pageNum - 1) * PAGE_SIZE;
  const pageRows = useMemo(() => filtered.slice(pageStart, pageStart + PAGE_SIZE), [filtered, pageStart]);


  const filteredIds = useMemo(() => new Set(filtered.map((r) => r.id)), [filtered]);
  useEffect(() => {
    setSelected((prev) => new Set(Array.from(prev).filter((id) => filteredIds.has(id))));
  }, [filteredIds]);

  const allChecked = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  function toggleAll() {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.id)));
  }
  function toggleOne(rid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rid)) next.delete(rid);
      else next.add(rid);
      return next;
    });
  }

  async function updateField(rowId: string, field: ExtractField, value: string) {
    const patch = { [field]: value } as never;
    const { error } = await supabase.from("extractions").update(patch).eq("id", rowId);
    if (error) toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["extractions", id] });
  }

  async function retryOne(rowId: string) {
    await runQueue([rowId]);
  }

  async function requeueFailed() {
    const ids = (rows ?? []).filter((r) => r.status === "failed").map((r) => r.id);
    if (ids.length === 0) return toast.info("Nothing failed");
    await runQueue(ids);
  }

  async function bulkMarkReviewed() {
    if (selected.size === 0) return;
    const { error } = await supabase.from("extractions").update({ needs_review: false }).in("id", Array.from(selected));
    if (error) return toast.error(error.message);
    toast.success(`Marked ${selected.size} as reviewed`);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["extractions", id] });
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!(await confirmDialog({ title: `Delete ${selected.size} row(s)?`, description: "This cannot be undone.", confirmLabel: "Delete", destructive: true }))) return;
    const { error } = await supabase.from("extractions").delete().in("id", Array.from(selected));
    if (error) return toast.error(error.message);
    toast.success(`Deleted ${selected.size}`);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["extractions", id] });
    qc.invalidateQueries({ queryKey: ["batch", id] });
  }

  async function bulkRequeue() {
    if (selected.size === 0) return;
    await runQueue(Array.from(selected));
  }

  async function exportExcel() {
    const { data: sessData } = await supabase.auth.getSession();
    const token = sessData.session?.access_token;
    if (!token) return toast.error("Not signed in");
    const res = await fetch(`/api/export/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return toast.error("Export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${batch?.name ?? "orders"}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }


  function setFilter(patch: Partial<z.infer<typeof filterSchema>>) {
    // Reset to page 1 whenever a non-page filter changes.
    const resetPage = !("page" in patch);
    navigate({ search: (prev: z.infer<typeof filterSchema>) => ({ ...prev, ...patch, ...(resetPage ? { page: 1 } : {}) }) });
  }
  function goToPage(p: number) {
    navigate({ search: (prev: z.infer<typeof filterSchema>) => ({ ...prev, page: Math.max(1, Math.min(totalPages, p)) }) });
  }

  if (!batch) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  const total = batch.total_images;
  const done = rows
    ? rows.filter((r) => r.status === "success" || r.status === "failed" || r.status === "cancelled").length
    : batch.processed_count + batch.failed_count;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isActivelyRunning =
    queueRunning || browserProcessing.current || (batch.status === "processing" && staleProcessingCount === 0) || trulyActiveCount > 0;
  const showResume = !isActivelyRunning && pausedCount > 0 && batch.status !== "cancelled";
  const showStart =
    !isActivelyRunning &&
    !showResume &&
    (activeCount > 0 || recoverableFailedCount > 0) &&
    batch.status !== "cancelled";
  const showPause = isActivelyRunning;

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2 -ml-3">
            <Link to="/batches"><ArrowLeft className="w-4 h-4 mr-1" /> All batches</Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{batch.name}</h1>
          <div className="text-sm text-muted-foreground mt-1">
            {total} images · {batch.processed_count} extracted · {failedCount} failed · {batch.duplicate_count} duplicates
</div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["extractions", id] })}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
          {failedCount > 0 && (
            <Button variant="outline" onClick={requeueFailed}>
              <PlayCircle className="w-4 h-4 mr-2" /> Requeue failed ({failedCount})
            </Button>
          )}
          <Button className="gradient-brand px-6 font-semibold" onClick={exportExcel} disabled={batch.processed_count === 0}>
            <Download className="w-4 h-4 mr-2" /> Export Excel
          </Button>
        </div>
      </div>

      {batch.status !== "completed" && (
        <Card className="rounded-2xl border-slate-200/60 shadow-sm overflow-hidden bg-slate-50/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between gap-3 text-sm mb-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span>Processing progress</span>
                {(() => {
                  const isRunning = queueRunning || browserProcessing.current || (batch.status === "processing" && staleProcessingCount === 0) || trulyActiveCount > 0;
                  const isPaused = batch.status === "paused" || (pausedCount > 0 && !isRunning);
                  const isCancelled = batch.status === "cancelled";
                  if (isRunning) {
                    return (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Running
                      </span>
                    );
                  }
                  if (isPaused) {
                    return (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Paused
                      </span>
                    );
                  }
                  if (isCancelled) {
                    return (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-2xl bg-muted text-muted-foreground">
                        Cancelled
                      </span>
                    );
                  }
                  return (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-2xl bg-muted text-muted-foreground">
                      Idle
                    </span>
                  );
                })()}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {(showResume || showStart) && (
                  <Button size="sm" variant="outline" onClick={startPending}>
                    <PlayCircle className="w-4 h-4 mr-2" /> {showResume ? "Resume" : "Start"} ({showResume ? pausedCount : activeCount + recoverableFailedCount})
                  </Button>
                )}
                {showPause && (
                  <Button size="sm" variant="outline" onClick={pauseProcessing}>
                    <PauseCircle className="w-4 h-4 mr-2" /> Pause
                  </Button>
                )}
                {cancellableCount > 0 && batch.status !== "cancelled" && (
                  <Button size="sm" variant="outline" onClick={cancelProcessing}>
                    <XCircle className="w-4 h-4 mr-2" /> Cancel
                  </Button>
                )}
                <span className="text-muted-foreground tabular-nums">{pct}%</span>
              </div>
            </div>
            <div className="h-2 rounded-2xl bg-slate-200 overflow-hidden">
              <div className="h-full bg-primary transition-all duration-500 ease-out" style={{ width: `${pct}%` }} />
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl border-slate-200/60 shadow-sm">
        <CardContent className="pt-6 flex flex-wrap gap-4 items-end">
          <FilterSelect label="Status" value={filters.status} onChange={(v) => setFilter({ status: v })}
            options={[{ v: "all", l: "All" }, { v: "pending", l: "Pending" }, { v: "processing", l: "Processing" }, { v: "success", l: "Success" }, { v: "failed", l: "Failed" }, { v: "paused", l: "Paused" }, { v: "cancelled", l: "Cancelled" }]} />
          <FilterSelect label="Review" value={filters.review} onChange={(v) => setFilter({ review: v })}
            options={[{ v: "all", l: "All" }, { v: "yes", l: "Needs review" }, { v: "no", l: "Reviewed" }]} />
          <FilterSelect label="Duplicates" value={filters.dup} onChange={(v) => setFilter({ dup: v })}
            options={[{ v: "all", l: "All" }, { v: "yes", l: "Duplicates only" }, { v: "no", l: "No duplicates" }]} />
          <div className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500/80">Network</div>
            <Input value={filters.network} onChange={(e) => setFilter({ network: e.target.value })} className="h-8 w-32" placeholder="Any" />
          </div>
          <div className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500/80">Branch</div>
            <Input value={filters.branch} onChange={(e) => setFilter({ branch: e.target.value })} className="h-8 w-32" placeholder="Any" />
          </div>
          <div className="ml-auto text-[10px] font-bold uppercase tracking-wider text-slate-500/80">
            {pageNum}/{totalPages} · {pageRows.length} of {totalFiltered} rows
          </div>
        </CardContent>
      </Card>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 p-3 px-4 text-[11px] uppercase font-bold tracking-wider animate-in fade-in slide-in-from-top-2">
          <span>{selected.size} items selected</span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={bulkMarkReviewed}>
            <CheckCheck className="w-3.5 h-3.5 mr-1.5" /> Mark reviewed
          </Button>
          <Button size="sm" variant="outline" onClick={bulkRequeue}>
            <PlayCircle className="w-3.5 h-3.5 mr-1.5" /> Re-queue
          </Button>
          <Button size="sm" variant="destructive" onClick={bulkDelete}>
            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
          </Button>
        </div>
      )}

      <Card className="rounded-2xl border-slate-200/60 shadow-sm overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Extracted rows</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {!rows ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : (
          <table className="w-full text-[11px] min-w-[1200px] border-collapse">
            <thead className="bg-slate-50/80 text-[11px] uppercase tracking-wider text-slate-500/80 font-bold border-b border-slate-200/60">
              <tr>
                <th className="p-2 w-8">
                  <Checkbox checked={allChecked} onCheckedChange={toggleAll} aria-label="Select all rows" />
                </th>
                <th className="text-left p-2 sticky left-8 bg-slate-50/80 z-10">#</th>
                <th className="text-left p-2">Image</th>
                <SortableTh label="Status" active={sortKey === "status"} dir={sortDir} onClick={() => toggleSort("status")} />
                {EXTRACT_FIELDS.slice(0, 10).map((f) => (
                  <SortableTh key={f} label={FIELD_LABELS[f]} active={sortKey === f} dir={sortDir} onClick={() => toggleSort(f)} className="min-w-[120px]" />
                ))}
                <th className="text-left p-2">More</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, i) => (
                <tr key={r.id} className={cn("border-t border-slate-100 hover:bg-slate-50/30 transition-colors", r.is_duplicate && "bg-amber-50/30")}>
                  <td className="p-2">
                    <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleOne(r.id)} aria-label={`Select row ${pageStart + i + 1}`} />
                  </td>
                  <td className="p-2 text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <ConfidenceDot avg={r.avg_confidence as number | null | undefined} perField={r.confidence as Record<string, number> | null | undefined} />
                      <span>{pageStart + i + 1}</span>
                    </div>
                  </td>
                  <td className="p-2">
                    <Button variant="ghost" size="sm" onClick={() => setViewingPath(r.storage_path)} aria-label="View screenshot">
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                  <td className="p-2">
                    <StatusBadge row={r} onRetry={() => retryOne(r.id)} />
                  </td>
                  {EXTRACT_FIELDS.slice(0, 10).map((f) => (
                    <td key={f} className="p-1">
                      <EditableCell
                        value={((r as Record<string, unknown>)[f] as string | null) ?? ""}
                        confidence={(r.confidence as Record<string, number> | null)?.[f]}
                        onSave={(v) => updateField(r.id, f, v)}
                        disabled={r.status !== "success"}
                      />
                    </td>
                  ))}
                  <td className="p-2">
                    <details>
                      <summary className="cursor-pointer text-[10px] font-bold text-primary uppercase tracking-wider hover:underline">View All Details</summary>
                      <div className="mt-2 grid grid-cols-2 gap-1 min-w-[400px]">
                        {EXTRACT_FIELDS.slice(10).map((f) => (
                          <div key={f}>
                            <div className="text-[9px] uppercase font-bold text-slate-400">{FIELD_LABELS[f]}</div>
                            <EditableCell
                              value={((r as Record<string, unknown>)[f] as string | null) ?? ""}
                              confidence={(r.confidence as Record<string, number> | null)?.[f]}
                              onSave={(v) => updateField(r.id, f, v)}
                              disabled={r.status !== "success"}
                            />
                          </div>
                        ))}
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={15} className="p-8 text-center text-muted-foreground">
                    {(rows?.length ?? 0) === 0 ? "No extractions yet" : "No rows match the current filters"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500/80">
                Rows {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, totalFiltered)} of {totalFiltered}
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" className="h-7" onClick={() => goToPage(1)} disabled={pageNum <= 1}>« First</Button>
                <Button size="sm" variant="outline" className="h-7" onClick={() => goToPage(pageNum - 1)} disabled={pageNum <= 1}>‹ Prev</Button>
                <span className="px-2 tabular-nums font-bold text-[11px] uppercase text-slate-500/80">Page {pageNum} / {totalPages}</span>
                <Button size="sm" variant="outline" className="h-7" onClick={() => goToPage(pageNum + 1)} disabled={pageNum >= totalPages}>Next ›</Button>
                <Button size="sm" variant="outline" className="h-7" onClick={() => goToPage(totalPages)} disabled={pageNum >= totalPages}>Last »</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!viewingPath} onOpenChange={(o) => !o && setViewingPath(null)}>
        <DialogContent className="max-w-[95vw] sm:max-w-4xl p-4 sm:p-6 overflow-hidden flex flex-col max-h-[90vh]">
          <DialogHeader className="flex-row items-center justify-between space-y-0">
            <DialogTitle>Screenshot & OCR Audit</DialogTitle>
            <div className="flex gap-2 mr-6">
              {rows?.find(r => r.storage_path === viewingPath) && (rows?.find(r => r.storage_path === viewingPath) as any).raw_ocr_text && (
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={() => {
                    const row = rows?.find(r => r.storage_path === viewingPath) as any;
                    if (row?.raw_ocr_text) {
                      toast.info("Raw OCR Data", {
                        description: row.raw_ocr_text.substring(0, 500) + (row.raw_ocr_text.length > 500 ? "..." : ""),
                        action: {
                          label: "Copy All",
                          onClick: () => navigator.clipboard.writeText(row.raw_ocr_text)
                        }
                      });
                    }
                  }}
                >
                  <FileText className="w-4 h-4 mr-2" /> View Raw OCR
                </Button>
              )}
            </div>
          </DialogHeader>
          <div className="flex flex-col md:flex-row gap-4 overflow-hidden mt-4">
            <div className="flex-1 items-center justify-center overflow-auto bg-muted/30 rounded border">
              {imgUrl ? (
                <img
                  src={imgUrl}
                  alt="screenshot"
                  className="max-h-[70vh] w-auto max-w-full h-auto object-contain mx-auto"
                />
              ) : (
                <div className="text-muted-foreground text-sm py-12 text-center">Loading…</div>
              )}
            </div>
            {rows?.find(r => r.storage_path === viewingPath) && (rows?.find(r => r.storage_path === viewingPath) as any).raw_ocr_text && (
              <div className="w-full md:w-80 flex flex-col gap-2 border rounded p-3 bg-muted/10 overflow-hidden">
                <div className="flex items-center gap-2 text-sm font-medium border-b pb-2">
                  <Search className="w-4 h-4" />
                  <span>OCR Text Insight</span>
                </div>
                <div className="flex-1 overflow-auto text-[11px] font-mono leading-relaxed whitespace-pre-wrap">
                  {(rows?.find(r => r.storage_path === viewingPath) as any).raw_ocr_text}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}