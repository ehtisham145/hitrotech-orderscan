import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";

// extract-core.server is dynamically imported inside processExtractionNowCore
// — mocked here so the real extraction pipeline (OCR/AI/DB writes) never runs
// as a side effect of testing this file's own retry-decision logic.
vi.mock("@/lib/extract-core.server", () => ({
  runExtraction: vi.fn(),
}));

import { queueExtractionsCore, processExtractionNowCore, keepBatchRowsFreshCore } from "./queue.functions";
import { runExtraction } from "@/lib/extract-core.server";

const PROFILE_ROW = { data: { active_workspace_id: "ws1" }, error: null };

describe("keepBatchRowsFreshCore", () => {
  it("returns immediately without any Supabase calls when batch_id is empty", async () => {
    const { client } = createMockSupabase();
    const result = await keepBatchRowsFreshCore({ batch_id: "" }, { supabase: client as any, userId: "u1" });
    expect(result).toEqual({ refreshed: 0 });
  });

  it("only touches rows genuinely status = 'pending', and returns the refreshed count", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE_ROW);
    queueResponse("extractions", { data: [{ id: "e1" }, { id: "e2" }], error: null });

    const result = await keepBatchRowsFreshCore({ batch_id: "b1" }, { supabase: client as any, userId: "u1" });

    expect(result).toEqual({ refreshed: 2 });
    expect(getChain("extractions", 0).eq).toHaveBeenCalledWith("status", "pending");
  });

  it("throws if the update query itself errors", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE_ROW);
    queueResponse("extractions", { data: null, error: { message: "boom" } });

    await expect(keepBatchRowsFreshCore({ batch_id: "b1" }, { supabase: client as any, userId: "u1" })).rejects.toThrow("boom");
  });
});

describe("processExtractionNowCore", () => {
  beforeEach(() => {
    vi.mocked(runExtraction).mockReset();
  });

  it("throws for a missing extraction_id without touching Supabase at all", async () => {
    const { client } = createMockSupabase();
    await expect(processExtractionNowCore({ extraction_id: "" }, { supabase: client as any, userId: "u1" })).rejects.toThrow(
      "Missing extraction_id",
    );
  });

  it("throws 'Extraction not found' when the row lookup returns nothing", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE_ROW);
    queueResponse("extractions", { data: null, error: null });

    await expect(
      processExtractionNowCore({ extraction_id: "e1" }, { supabase: client as any, userId: "u1" }),
    ).rejects.toThrow("Extraction not found");
  });

  it("does not reset the row when the extraction succeeds", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE_ROW);
    queueResponse("extractions", { data: { id: "e1" }, error: null });
    vi.mocked(runExtraction).mockResolvedValue({ ok: true, extraction_id: "e1" });

    const result = await processExtractionNowCore({ extraction_id: "e1" }, { supabase: client as any, userId: "u1" });

    // No third "extractions" response was queued for a reset-to-pending
    // update — if the code tried to make that call, the mock would throw.
    expect(result).toEqual({ ok: true, extraction_id: "e1" });
  });

  it("resets the row to pending on a claim_failed error (today's deadlock-retry fix's caller-side half)", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE_ROW);
    queueResponse("extractions", { data: { id: "e1" }, error: null });
    queueResponse("extractions", { data: null, error: null }); // the reset-to-pending update
    vi.mocked(runExtraction).mockResolvedValue({ ok: false, error: "claim_failed" });

    await processExtractionNowCore({ extraction_id: "e1" }, { supabase: client as any, userId: "u1" });

    const resetChain = getChain("extractions", 1);
    expect(resetChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", error_message: expect.stringContaining("claim_failed") }),
    );
    expect(resetChain.in).toHaveBeenCalledWith("status", ["failed", "processing"]);
  });

  it("does NOT reset the row on already_processing — that means a different caller is actively working it", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE_ROW);
    queueResponse("extractions", { data: { id: "e1" }, error: null });
    // No third "extractions" response queued — the mock throws if the code
    // tries to write one, so this test passing IS the assertion.
    vi.mocked(runExtraction).mockResolvedValue({ ok: false, error: "already_processing" });

    const result = await processExtractionNowCore({ extraction_id: "e1" }, { supabase: client as any, userId: "u1" });
    expect(result).toEqual({ ok: false, error: "already_processing" });
  });

  it("does NOT reset the row on already_claimed either, for the same reason", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE_ROW);
    queueResponse("extractions", { data: { id: "e1" }, error: null });
    vi.mocked(runExtraction).mockResolvedValue({ ok: false, error: "already_claimed" });

    const result = await processExtractionNowCore({ extraction_id: "e1" }, { supabase: client as any, userId: "u1" });
    expect(result).toEqual({ ok: false, error: "already_claimed" });
  });

  it("resets the row to pending on 'AI not configured'", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE_ROW);
    queueResponse("extractions", { data: { id: "e1" }, error: null });
    queueResponse("extractions", { data: null, error: null });
    vi.mocked(runExtraction).mockResolvedValue({ ok: false, error: "AI not configured" });

    // Passes as long as the reset-update's queued response actually gets
    // consumed (mock throws otherwise).
    await processExtractionNowCore({ extraction_id: "e1" }, { supabase: client as any, userId: "u1" });
  });
});

describe("queueExtractionsCore", () => {
  const originalInngestEventKey = process.env.INNGEST_EVENT_KEY;
  const originalInngestSigningKey = process.env.INNGEST_SIGNING_KEY;
  beforeEach(() => {
    delete process.env.INNGEST_EVENT_KEY;
    delete process.env.INNGEST_SIGNING_KEY;
  });
  afterEach(() => {
    if (originalInngestEventKey === undefined) delete process.env.INNGEST_EVENT_KEY;
    else process.env.INNGEST_EVENT_KEY = originalInngestEventKey;
    if (originalInngestSigningKey === undefined) delete process.env.INNGEST_SIGNING_KEY;
    else process.env.INNGEST_SIGNING_KEY = originalInngestSigningKey;
  });

  it("returns immediately for an empty id list, without any Supabase calls", async () => {
    const { client } = createMockSupabase();
    const result = await queueExtractionsCore({ extraction_ids: [] }, { supabase: client as any, userId: "u1" });
    expect(result).toEqual({ queued: 0, failed_to_queue: 0 });
  });

  it("includes a stale 'processing' row but excludes a fresh one — and falls back to direct processing when Inngest is unconfigured (this deployment's actual mode)", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    const staleUpdatedAt = new Date(Date.now() - 5 * 60_000).toISOString(); // 5 min ago > 2 min cutoff
    const freshUpdatedAt = new Date(Date.now() - 10_000).toISOString(); // 10s ago

    queueResponse("profiles", PROFILE_ROW);
    queueResponse("extractions", {
      data: [
        { id: "e1", batch_id: "b1", status: "pending", updated_at: freshUpdatedAt },
        { id: "e2", batch_id: "b1", status: "processing", updated_at: staleUpdatedAt }, // stale -> included
        { id: "e3", batch_id: "b1", status: "processing", updated_at: freshUpdatedAt }, // fresh -> excluded
      ],
      error: null,
    });
    queueResponse("extractions", { data: null, error: null }); // "Reset to pending" write
    queueResponse("batches", { data: null, error: null }); // set batch status=processing
    queueResponse("extractions", { data: null, error: null }); // keepPendingForDirectProcessing's write
    queueResponse("extractions", { data: [{ status: "pending", is_duplicate: false }, { status: "pending", is_duplicate: false }], error: null }); // syncBatchCounts' read
    queueResponse("batches", { data: null, error: null }); // syncBatchCounts' write

    const result = await queueExtractionsCore(
      { extraction_ids: ["e1", "e2", "e3"] },
      { supabase: client as any, userId: "u1" },
    );

    expect(result).toEqual({ queued: 0, failed_to_queue: 2, fallback: "direct" });
    // The reset-to-pending write only targeted e1 and e2 -- e3 (fresh
    // "processing") was correctly excluded as genuinely in-flight elsewhere.
    expect(getChain("extractions", 1).in).toHaveBeenCalledWith("id", ["e1", "e2"]);
  });
});
