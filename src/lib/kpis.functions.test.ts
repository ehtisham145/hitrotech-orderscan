import { describe, it, expect } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";
import { getDashboardKpisCore } from "./kpis.functions";

const PROFILE = { data: { active_workspace_id: "ws1" }, error: null };
const ctx = (client: unknown) => ({ supabase: client as never, userId: "u1" });

const queueHappyPath = (queueResponse: ReturnType<typeof createMockSupabase>["queueResponse"]) => {
  queueResponse("extractions", {
    data: [{ partner_id: "p1", commission_amount: 100, store_id: "s1", activation_date_parsed: null }],
    error: null,
  });
  queueResponse("extractions", { data: [], error: null });
  queueResponse("partners", { data: [{ id: "p1", name: "Alpha", role: "retailer", store_id: "s1", active: true }], error: null });
  queueResponse("commission_slabs", { data: [], error: null });
  queueResponse("employees", { data: [{ salary: 5000 }], error: null });
};

describe("getDashboardKpisCore", () => {
  it("computes MTD totals, employee cost, and top stores/partners", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueHappyPath(queueResponse);

    const result = await getDashboardKpisCore(ctx(client));

    expect(result.mtd).toEqual({ count: 1, amount: 100, total_expenses: 5100, employee_cost: 5000 });
    expect(result.top_stores[0]).toMatchObject({ store_id: "s1", count: 1, amount: 100 });
    expect(result.top_partners[0]).toMatchObject({ partner_id: "p1", name: "Alpha", count: 1 });
  });

  it("surfaces the this-month extractions query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("extractions", "boom");
    queueResponse("extractions", { data: [], error: null });
    queueResponse("partners", { data: [], error: null });
    queueResponse("commission_slabs", { data: [], error: null });
    queueResponse("employees", { data: [], error: null });
    await expect(getDashboardKpisCore(ctx(client))).rejects.toThrow("boom");
  });

  it("surfaces the employees query error instead of reporting zero expenses", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("extractions", { data: [], error: null });
    queueResponse("extractions", { data: [], error: null });
    queueResponse("partners", { data: [], error: null });
    queueResponse("commission_slabs", { data: [], error: null });
    queueError("employees", "emp boom");
    await expect(getDashboardKpisCore(ctx(client))).rejects.toThrow("emp boom");
  });

  it("surfaces the slabs query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("extractions", { data: [], error: null });
    queueResponse("extractions", { data: [], error: null });
    queueResponse("partners", { data: [], error: null });
    queueError("commission_slabs", "slab boom");
    queueResponse("employees", { data: [], error: null });
    await expect(getDashboardKpisCore(ctx(client))).rejects.toThrow("slab boom");
  });

  it("flags a partner within 3 activations of the next commission slab", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("extractions", {
      data: Array.from({ length: 3 }, () => ({ partner_id: "p1", commission_amount: 50, store_id: "s1", activation_date_parsed: null })),
      error: null,
    });
    queueResponse("extractions", { data: [], error: null });
    queueResponse("partners", { data: [{ id: "p1", name: "Alpha", role: "retailer", store_id: "s1", active: true }], error: null });
    queueResponse("commission_slabs", {
      data: [
        { role: "retailer", min_count: 0, max_count: 4, rate_pkr: 50, active: true, effective_from: null, effective_to: null },
        { role: "retailer", min_count: 5, max_count: null, rate_pkr: 80, active: true, effective_from: null, effective_to: null },
      ],
      error: null,
    });
    queueResponse("employees", { data: [], error: null });

    const result = await getDashboardKpisCore(ctx(client));
    expect(result.near_slab).toHaveLength(1);
    expect(result.near_slab[0]).toMatchObject({ partner_id: "p1", to_go: 2, next_rate: 80 });
  });
});
