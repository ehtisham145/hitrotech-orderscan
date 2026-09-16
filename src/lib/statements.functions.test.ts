import { describe, it, expect } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";
import { getPartnerStatementCore, getPartnerHistoryCore } from "./statements.functions";

const PROFILE = { data: { active_workspace_id: "ws1" }, error: null };
const ctx = (client: unknown) => ({ supabase: client as never, userId: "u1" });

const PARTNER = { id: "p1", role: "retailer", name: "Alpha" };

describe("getPartnerStatementCore", () => {
  it("normalises a bare YYYY-MM month and scopes every query to the workspace", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partners", { data: PARTNER, error: null });
    queueResponse("extractions", { data: [{ id: "x1", commission_amount: 100 }, { id: "x2", commission_amount: 100 }], error: null });
    queueResponse("partner_payouts", { data: null, error: null });
    queueResponse("commission_slabs", {
      data: [{ role: "retailer", min_count: 0, max_count: 4, rate_pkr: 50, active: true, effective_from: null, effective_to: null }],
      error: null,
    });

    const result = await getPartnerStatementCore({ partner_id: "p1", month: "2026-09" }, ctx(client));

    // Regression guard: monthStart used to turn "2026-09" into "2026-0901".
    expect(result.month).toBe("2026-09-01");
    expect(result.totals).toEqual({ count: 2, rate: 50, amount: 100 });
    expect(getChain("extractions").eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(getChain("commission_slabs").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("picks the correct slab tier and reports how many activations to the next one", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partners", { data: PARTNER, error: null });
    queueResponse("extractions", { data: Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, commission_amount: 0 })), error: null });
    queueResponse("partner_payouts", { data: null, error: null });
    queueResponse("commission_slabs", {
      data: [
        { role: "retailer", min_count: 0, max_count: 4, rate_pkr: 50, active: true, effective_from: null, effective_to: null },
        { role: "retailer", min_count: 5, max_count: null, rate_pkr: 80, active: true, effective_from: null, effective_to: null },
      ],
      error: null,
    });

    const result = await getPartnerStatementCore({ partner_id: "p1", month: "2026-09" }, ctx(client));
    expect(result.slab.current_rate).toBe(80);
    expect(result.slab.next_rate).toBeNull(); // already in the top, open-ended tier
  });

  it("throws Partner not found for an unknown or out-of-workspace id", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partners", { data: null, error: null });
    queueResponse("extractions", { data: [], error: null });
    queueResponse("partner_payouts", { data: null, error: null });
    queueResponse("commission_slabs", { data: [], error: null });
    await expect(getPartnerStatementCore({ partner_id: "gone" }, ctx(client))).rejects.toThrow("Partner not found");
  });

  it("surfaces a partner query error distinctly from 'not found'", async () => {
    const { client, queueError, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("partners", "partner boom");
    queueResponse("extractions", { data: [], error: null });
    queueResponse("partner_payouts", { data: null, error: null });
    queueResponse("commission_slabs", { data: [], error: null });
    await expect(getPartnerStatementCore({ partner_id: "p1" }, ctx(client))).rejects.toThrow("partner boom");
  });

  it("surfaces an activations query error instead of reporting a zero-activation month", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partners", { data: PARTNER, error: null });
    queueError("extractions", "ext boom");
    queueResponse("partner_payouts", { data: null, error: null });
    queueResponse("commission_slabs", { data: [], error: null });
    await expect(getPartnerStatementCore({ partner_id: "p1" }, ctx(client))).rejects.toThrow("ext boom");
  });

  it("surfaces a slabs query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partners", { data: PARTNER, error: null });
    queueResponse("extractions", { data: [], error: null });
    queueResponse("partner_payouts", { data: null, error: null });
    queueError("commission_slabs", "slab boom");
    await expect(getPartnerStatementCore({ partner_id: "p1" }, ctx(client))).rejects.toThrow("slab boom");
  });
});

describe("getPartnerHistoryCore", () => {
  it("builds a monthly series scoped to the workspace", async () => {
    // The function computes "current month" from the real clock at call
    // time, so the fixture has to line up with whenever the test actually
    // runs rather than a fixed date.
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partners", { data: PARTNER, error: null });
    queueResponse("extractions", {
      data: [{ commission_month: currentMonth, commission_amount: 50, activation_date_parsed: currentMonth }],
      error: null,
    });
    queueResponse("partner_payouts", { data: [{ month: currentMonth, status: "paid", amount_pkr: 50, paid_at: "t" }], error: null });

    const result = await getPartnerHistoryCore({ partner_id: "p1", months: 3 }, ctx(client));

    expect(result.series).toHaveLength(3);
    expect(result.totals.count).toBe(1);
    expect(result.totals.commission).toBe(50);
    expect(getChain("extractions").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("clamps months to the 1..24 range", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partners", { data: PARTNER, error: null });
    queueResponse("extractions", { data: [], error: null });
    queueResponse("partner_payouts", { data: [], error: null });

    const result = await getPartnerHistoryCore({ partner_id: "p1", months: 999 }, ctx(client));
    expect(result.series).toHaveLength(24);
  });

  it("throws Partner not found for an unknown id", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partners", { data: null, error: null });
    queueResponse("extractions", { data: [], error: null });
    queueResponse("partner_payouts", { data: [], error: null });
    await expect(getPartnerHistoryCore({ partner_id: "gone" }, ctx(client))).rejects.toThrow("Partner not found");
  });

  it("surfaces a payouts query error instead of reporting no payout history", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partners", { data: PARTNER, error: null });
    queueResponse("extractions", { data: [], error: null });
    queueError("partner_payouts", "payout boom");
    await expect(getPartnerHistoryCore({ partner_id: "p1" }, ctx(client))).rejects.toThrow("payout boom");
  });
});
