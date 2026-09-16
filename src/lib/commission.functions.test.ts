import { describe, it, expect } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";
import {
  listActivationTypesCore,
  upsertActivationTypeCore,
  deleteActivationTypeCore,
  listSlabsCore,
  listPartnerSlabsCore,
  upsertSlabCore,
  deleteSlabCore,
  listUnassignedCore,
  assignExtractionToPartnerCore,
  getCommissionSummaryCore,
} from "./commission.functions";

const PROFILE = { data: { active_workspace_id: "ws1" }, error: null };
const ctx = (client: unknown) => ({ supabase: client as never, userId: "u1" });

const SLAB = {
  role: "retailer" as const,
  min_count: 1,
  max_count: 10,
  rate_pkr: 500,
  active: true,
  partner_id: null,
};

describe("listActivationTypesCore", () => {
  it("returns the workspace's activation types", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("activation_types", { data: [{ id: "a1", name: "New" }], error: null });

    await expect(listActivationTypesCore(ctx(client))).resolves.toHaveLength(1);
    expect(getChain("activation_types").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("returns an empty array rather than null", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("activation_types", { data: null, error: null });
    await expect(listActivationTypesCore(ctx(client))).resolves.toEqual([]);
  });
});

describe("upsertActivationTypeCore / deleteActivationTypeCore", () => {
  it("upsert refuses a caller without a write role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(upsertActivationTypeCore({ name: "New" } as never, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("delete refuses a caller without a write role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(deleteActivationTypeCore({ id: "a1" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("delete is scoped to the caller's workspace", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("activation_types", { data: null, error: null });

    await deleteActivationTypeCore({ id: "a1" }, ctx(client));
    expect(getChain("activation_types").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });
});

describe("listSlabsCore / listPartnerSlabsCore", () => {
  it("lists the workspace's slabs", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("commission_slabs", { data: [{ id: "s1" }], error: null });

    await expect(listSlabsCore(ctx(client))).resolves.toEqual([{ id: "s1" }]);
    expect(getChain("commission_slabs").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("surfaces a query error rather than an empty list", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("commission_slabs", "boom");
    await expect(listSlabsCore(ctx(client))).rejects.toThrow("boom");
  });

  it("partner slabs are filtered to the partner asked for", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("commission_slabs", { data: [], error: null });

    await listPartnerSlabsCore({ partner_id: "p1" }, ctx(client));
    expect(getChain("commission_slabs").eq).toHaveBeenCalledWith("partner_id", "p1");
  });
});

describe("upsertSlabCore", () => {
  it("refuses a caller without a write role, before reading anything", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(upsertSlabCore(SLAB, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("scans for overlapping slabs inside this workspace only", async () => {
    // Regression: the scan had no workspace filter, so another workspace's
    // band could report a conflict that does not exist here — and a real
    // overlap in this workspace could be masked behind it.
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("commission_slabs", { data: [], error: null });   // conflict scan
    queueResponse("profiles", PROFILE);                              // workspace_id resolve
    queueResponse("commission_slabs", { data: null, error: null });  // insert

    await upsertSlabCore(SLAB, ctx(client));

    const scan = getChain("commission_slabs", 0);
    expect(scan.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(scan.eq).toHaveBeenCalledWith("role", "retailer");
    // A workspace-wide (non-partner) slab compares against other workspace-wide
    // slabs, not against partner-specific ones.
    expect(scan.is).toHaveBeenCalledWith("partner_id", null);
  });

  it("rejects a slab that overlaps an existing band", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("commission_slabs", {
      data: [{ id: "existing", min_count: 5, max_count: 20, rate_pkr: 400, partner_id: null, activation_type_id: null, effective_from: null, effective_to: null }],
      error: null,
    });

    await expect(upsertSlabCore(SLAB, ctx(client))).rejects.toThrow();
  });

  it("scopes an edit by workspace as well as id", async () => {
    // Regression: the update matched on id alone, leaving RLS as the only thing
    // stopping an admin of one workspace editing another workspace's rate.
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("commission_slabs", { data: [], error: null });          // conflict scan
    queueResponse("commission_slabs", { data: [{ id: "s1" }], error: null }); // update

    await upsertSlabCore({ ...SLAB, id: "s1" }, ctx(client));

    const upd = getChain("commission_slabs", 1);
    expect(upd.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(upd.eq).toHaveBeenCalledWith("id", "s1");
  });

  it("fails when an edit matches no row, instead of reporting a phantom save", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("commission_slabs", { data: [], error: null });     // conflict scan
    queueResponse("commission_slabs", { data: [], error: null });     // update matched nothing

    await expect(upsertSlabCore({ ...SLAB, id: "other-ws" }, ctx(client)))
      .rejects.toThrow("Slab not found in this workspace");
  });

  it("takes workspace_id from the partner when the slab is partner-specific", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("commission_slabs", { data: [], error: null });                 // conflict scan
    queueResponse("partners", { data: { workspace_id: "ws-from-partner" }, error: null });
    queueResponse("commission_slabs", { data: null, error: null });               // insert

    await upsertSlabCore({ ...SLAB, partner_id: "p1" }, ctx(client));

    const inserted = getChain("commission_slabs", 1).insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.workspace_id).toBe("ws-from-partner");
  });

  it("refuses to insert when no workspace can be resolved at all", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("commission_slabs", { data: [], error: null });
    queueResponse("profiles", { data: { active_workspace_id: null }, error: null });

    await expect(upsertSlabCore(SLAB, ctx(client))).rejects.toThrow("No workspace context found for slab.");
  });
});

describe("deleteSlabCore", () => {
  it("deletes only within the caller's workspace", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("commission_slabs", { data: null, error: null });

    await expect(deleteSlabCore({ id: "s1" }, ctx(client))).resolves.toEqual({ ok: true });
    const chain = getChain("commission_slabs");
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("id", "s1");
  });

  it("refuses a caller without a write role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(deleteSlabCore({ id: "s1" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });
});

describe("listUnassignedCore", () => {
  it("only returns successful, non-duplicate rows with no partner yet", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("extractions", { data: [{ id: "e1" }], error: null });

    await listUnassignedCore(ctx(client));

    const chain = getChain("extractions");
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("status", "success");
    expect(chain.eq).toHaveBeenCalledWith("is_duplicate", false);
    expect(chain.is).toHaveBeenCalledWith("partner_id", null);
  });
});

describe("assignExtractionToPartnerCore", () => {
  const input = { extraction_id: "e1", partner_id: "p1" };

  it("refuses a partner that belongs to another workspace", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("partners", { data: null, error: null });
    await expect(assignExtractionToPartnerCore(input, ctx(client)))
      .rejects.toThrow("Partner not found in this workspace");
  });

  it("files the activation under the first of its activation month", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("partners", { data: { id: "p1" }, error: null });
    queueResponse("extractions", { data: { activation_date_parsed: "2026-09-15" }, error: null });
    queueResponse("extractions", { data: null, error: null });

    await assignExtractionToPartnerCore(input, ctx(client));

    const written = getChain("extractions", 1).update.mock.calls[0][0] as Record<string, unknown>;
    expect(written).toEqual({ partner_id: "p1", commission_month: "2026-09-01" });
  });

  it("merges a new match key into the partner's existing ones without duplicating", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("partners", { data: { id: "p1" }, error: null });
    queueResponse("extractions", { data: { activation_date_parsed: "2026-09-15" }, error: null });
    queueResponse("extractions", { data: null, error: null });
    queueResponse("partners", { data: { match_keys: ["acme", " old "] }, error: null });
    queueResponse("partners", { data: null, error: null });

    await assignExtractionToPartnerCore({ ...input, add_match_key: " acme " }, ctx(client));

    const keys = (getChain("partners", 2).update.mock.calls[0][0] as { match_keys: string[] }).match_keys;
    expect(keys.sort()).toEqual(["acme", "old"]);
  });

  it("surfaces a failure to save the match key instead of silently dropping it", async () => {
    // Was fire-and-forget: the write could fail and the call still returned ok.
    const { client, queueResponse, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("partners", { data: { id: "p1" }, error: null });
    queueResponse("extractions", { data: { activation_date_parsed: "2026-09-15" }, error: null });
    queueResponse("extractions", { data: null, error: null });
    queueResponse("partners", { data: { match_keys: [] }, error: null });
    queueError("partners", "write refused");

    await expect(assignExtractionToPartnerCore({ ...input, add_match_key: "acme" }, ctx(client)))
      .rejects.toThrow("write refused");
  });

  it("ignores a blank match key rather than storing an empty string", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("partners", { data: { id: "p1" }, error: null });
    queueResponse("extractions", { data: { activation_date_parsed: "2026-09-15" }, error: null });
    queueResponse("extractions", { data: null, error: null });
    // No further "partners" response queued — the mock throws if one is
    // requested, which is the assertion.
    await expect(assignExtractionToPartnerCore({ ...input, add_match_key: "   " }, ctx(client)))
      .resolves.toEqual({ ok: true });
  });
});

describe("getCommissionSummaryCore", () => {
  // Three queries run in parallel: assigned rows, the unassigned count, and the
  // partner directory. All three have to be queued.
  function queueSummary(
    queueResponse: ReturnType<typeof createMockSupabase>["queueResponse"],
    rows: unknown[],
    partners: unknown[],
  ) {
    queueResponse("profiles", PROFILE);
    queueResponse("extractions", { data: rows, error: null });
    queueResponse("extractions", { data: null, error: null, count: 3 } as never);
    queueResponse("partners", { data: partners, error: null });
  }

  it("scopes every one of its three queries to the caller's workspace", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueSummary(queueResponse, [], []);

    await getCommissionSummaryCore({ month: "2026-09" }, ctx(client));

    expect(getChain("extractions", 0).eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(getChain("extractions", 1).eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(getChain("partners", 0).eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("normalises the month to its first day, whatever precision was asked for", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueSummary(queueResponse, [], []);

    await getCommissionSummaryCore({ month: "2026-09-27" }, ctx(client));
    expect(getChain("extractions", 0).eq).toHaveBeenCalledWith("commission_month", "2026-09-01");
  });

  it("counts only assigned, successful, non-duplicate activations for that month", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueSummary(queueResponse, [], []);

    await getCommissionSummaryCore({ month: "2026-09" }, ctx(client));

    const assigned = getChain("extractions", 0);
    expect(assigned.eq).toHaveBeenCalledWith("status", "success");
    expect(assigned.eq).toHaveBeenCalledWith("is_duplicate", false);
    expect(assigned.not).toHaveBeenCalledWith("partner_id", "is", null);
  });

  it("totals commission per partner and overall", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueSummary(
      queueResponse,
      [
        { partner_id: "p1", commission_amount: 500 },
        { partner_id: "p1", commission_amount: 300 },
        { partner_id: "p2", commission_amount: 200 },
      ],
      [{ id: "p1", name: "Ali", role: "retailer", store_id: "S1" }],
    );

    const summary = await getCommissionSummaryCore({ month: "2026-09" }, ctx(client));

    expect(summary.total_commission).toBe(1000);
    expect(summary.total_activations).toBe(3);
    expect(summary.unassigned_count).toBe(3);
    expect(summary.month).toBe("2026-09-01");

    // Leaderboard is ordered by commission, and carries the partner's details
    // where they are known.
    expect(summary.leaderboard).toEqual([
      { id: "p1", count: 2, commission: 800, name: "Ali", role: "retailer", store_id: "S1" },
      { id: "p2", count: 1, commission: 200 },
    ]);
    expect(summary.top_earner).toMatchObject({ id: "p1", commission: 800 });
  });

  it("treats a missing commission amount as zero rather than NaN", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueSummary(
      queueResponse,
      [{ partner_id: "p1", commission_amount: null }, { partner_id: "p1", commission_amount: 250 }],
      [],
    );

    const summary = await getCommissionSummaryCore({ month: "2026-09" }, ctx(client));
    expect(summary.total_commission).toBe(250);
    expect(summary.leaderboard[0].count).toBe(2);
  });

  it("reports an empty month without a top earner", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueSummary(queueResponse, [], []);

    const summary = await getCommissionSummaryCore({ month: "2026-09" }, ctx(client));
    expect(summary.total_commission).toBe(0);
    expect(summary.top_earner).toBeNull();
    expect(summary.leaderboard).toEqual([]);
  });
});
