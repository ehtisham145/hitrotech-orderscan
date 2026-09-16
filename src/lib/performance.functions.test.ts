import { describe, it, expect } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";
import { getLeaderboardCore, getStorePerformanceCore } from "./performance.functions";

const PROFILE = { data: { active_workspace_id: "ws1" }, error: null };
const ctx = (client: unknown) => ({ supabase: client as never, userId: "u1" });

describe("getLeaderboardCore", () => {
  it("normalises a bare YYYY-MM month and ranks partners by commission", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partners", { data: [{ id: "p1", name: "Alpha", role: "retailer", store_id: "s1", active: true, phone: null, city: null }], error: null });
    queueResponse("commission_slabs", {
      data: [{ role: "retailer", min_count: 0, max_count: null, rate_pkr: 50, active: true, effective_from: null, effective_to: null }],
      error: null,
    });
    queueResponse("extractions", { data: [{ partner_id: "p1", commission_amount: 100 }, { partner_id: "p1", commission_amount: 100 }], error: null });

    const result = await getLeaderboardCore({ month: "2026-09" }, ctx(client));

    expect(result.month).toBe("2026-09-01"); // regression guard for the monthStart bug
    expect(result.rows[0]).toMatchObject({ id: "p1", count: 2, commission: 200, current_rate: 50 });
    expect(getChain("extractions").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("filters by role and store when given", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partners", {
      data: [
        { id: "p1", name: "A", role: "retailer", store_id: "s1", active: true, phone: null, city: null },
        { id: "p2", name: "B", role: "franchise_owner", store_id: "s2", active: true, phone: null, city: null },
      ],
      error: null,
    });
    queueResponse("commission_slabs", { data: [], error: null });
    queueResponse("extractions", { data: [], error: null });

    const result = await getLeaderboardCore({ role: "retailer" }, ctx(client));
    expect(result.rows.map((r: any) => r.id)).toEqual(["p1"]);
  });

  it("surfaces a partners query error", async () => {
    const { client, queueError, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("partners", "boom");
    queueResponse("commission_slabs", { data: [], error: null });
    queueResponse("extractions", { data: [], error: null });
    await expect(getLeaderboardCore({}, ctx(client))).rejects.toThrow("boom");
  });

  it("surfaces an extractions query error instead of reporting zero commission", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partners", { data: [], error: null });
    queueResponse("commission_slabs", { data: [], error: null });
    queueError("extractions", "ext boom");
    await expect(getLeaderboardCore({}, ctx(client))).rejects.toThrow("ext boom");
  });
});

describe("getStorePerformanceCore", () => {
  it("buckets activations, commission, and partner counts by store", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("extractions", {
      data: [
        { store_id: "s1", status: "success", is_duplicate: false, needs_review: false, partner_id: "p1" },
        { store_id: "s1", status: "failed", is_duplicate: false, needs_review: false, partner_id: null },
      ],
      error: null,
    });
    queueResponse("extractions", { data: [{ store_id: "s1", commission_amount: 100, partner_id: "p1" }], error: null });
    queueResponse("partners", { data: [{ id: "p1", store_id: "s1", active: true }], error: null });
    queueResponse("stores", { data: [{ code: "s1" }], error: null });

    const result = await getStorePerformanceCore({ month: "2026-09" }, ctx(client));

    expect(result.month).toBe("2026-09-01");
    expect(result.stores).toEqual([
      { store_id: "s1", total: 2, success: 1, duplicates: 0, failed: 1, needs_review: 0, unassigned: 0, commission: 100, partners_active: 1, partners_total: 1 },
    ]);
    expect(getChain("stores").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("only reports stores the workspace has explicitly added", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("extractions", { data: [{ store_id: "unmanaged", status: "success", is_duplicate: false, needs_review: false, partner_id: null }], error: null });
    queueResponse("extractions", { data: [], error: null });
    queueResponse("partners", { data: [], error: null });
    queueResponse("stores", { data: [{ code: "managed" }], error: null });

    const result = await getStorePerformanceCore({}, ctx(client));
    expect(result.stores.map((s: any) => s.store_id)).toEqual(["managed"]);
  });

  it("surfaces the all-activations query error", async () => {
    const { client, queueError, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("extractions", "boom");
    queueResponse("extractions", { data: [], error: null });
    queueResponse("partners", { data: [], error: null });
    queueResponse("stores", { data: [], error: null });
    await expect(getStorePerformanceCore({}, ctx(client))).rejects.toThrow("boom");
  });

  it("surfaces the stores query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("extractions", { data: [], error: null });
    queueResponse("extractions", { data: [], error: null });
    queueResponse("partners", { data: [], error: null });
    queueError("stores", "boom");
    await expect(getStorePerformanceCore({}, ctx(client))).rejects.toThrow("boom");
  });
});
