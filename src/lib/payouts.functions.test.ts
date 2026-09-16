import { describe, it, expect } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";
import {
  getPayoutSummaryCore,
  upsertPayoutCore,
  markPayoutStatusCore,
  generatePayoutsForMonthCore,
  bulkMarkPayoutsPaidCore,
} from "./payouts.functions";

const PROFILE = { data: { active_workspace_id: "ws1" }, error: null };
const ctx = (client: unknown) => ({ supabase: client as never, userId: "u1" });
const ok = { data: null, error: null };

describe("getPayoutSummaryCore", () => {
  it("scopes each of its reads to the caller's workspace", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partners", { data: [], error: null });
    queueResponse("extractions", { data: [], error: null });
    queueResponse("partner_payouts", { data: [], error: null });

    await getPayoutSummaryCore({ month: "2026-09" }, ctx(client));

    for (const t of ["partners", "extractions", "partner_payouts"]) {
      expect(getChain(t).eq).toHaveBeenCalledWith("workspace_id", "ws1");
    }
  });

  it("normalises a bare YYYY-MM input (no day component) correctly", async () => {
    // Regression guard: monthStart used to build this via
    // `input.slice(0, 8) + "01"`, valid only for a 10-char "YYYY-MM-DD"
    // input — a 7-char "YYYY-MM" input came out as "2026-0901", invalid.
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partners", { data: [], error: null });
    queueResponse("extractions", { data: [], error: null });
    queueResponse("partner_payouts", { data: [], error: null });

    await getPayoutSummaryCore({ month: "2026-09" }, ctx(client));

    expect(getChain("extractions").eq).toHaveBeenCalledWith("commission_month", "2026-09-01");
    expect(getChain("partner_payouts").eq).toHaveBeenCalledWith("month", "2026-09-01");
  });
});

const PAYOUT = { partner_id: "p1", month: "2026-09", activations_count: 2, rate_pkr: 500, amount_pkr: 1000 };

describe("upsertPayoutCore", () => {
  it("refuses a caller without a payout role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(upsertPayoutCore(PAYOUT, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("refuses a partner that belongs to another workspace", async () => {
    // Regression: the role check proved the caller managed *their* workspace,
    // then workspace_id was taken from the partner without comparing the two —
    // so an owner could file a payout into another tenant's workspace.
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("partners", { data: { workspace_id: "ws-other" }, error: null });

    await expect(upsertPayoutCore(PAYOUT, ctx(client))).rejects.toThrow("Partner not found in this workspace");
  });

  it("writes the payout when the partner is in the caller's workspace", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("partners", { data: { workspace_id: "ws1" }, error: null });
    queueResponse("partner_payouts", { data: { id: "po1" }, error: null });

    await upsertPayoutCore({ ...PAYOUT, month: "2026-09-27" }, ctx(client));

    const row = getChain("partner_payouts").upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({ workspace_id: "ws1", partner_id: "p1", month: "2026-09-01", status: "pending" });
    // Not marked paid, so no paid_at/paid_by is stamped.
    expect(row.paid_at).toBeNull();
    expect(row.paid_by).toBeNull();
  });

  it("stamps who paid and when, only when the status says paid", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("partners", { data: { workspace_id: "ws1" }, error: null });
    queueResponse("partner_payouts", { data: { id: "po1" }, error: null });

    await upsertPayoutCore({ ...PAYOUT, status: "paid" }, ctx(client));

    const row = getChain("partner_payouts").upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.paid_by).toBe("u1");
    expect(row.paid_at).toEqual(expect.any(String));
  });
});

describe("markPayoutStatusCore", () => {
  it("refuses a caller without a payout role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(markPayoutStatusCore({ payout_id: "po1", status: "paid" } as never, ctx(client)))
      .rejects.toThrow(/Forbidden/);
  });

  it("scopes the update by workspace and payout id", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("profiles", PROFILE);
    queueResponse("partner_payouts", { data: { id: "po1" }, error: null });

    await markPayoutStatusCore({ payout_id: "po1", status: "paid" } as never, ctx(client));

    const chain = getChain("partner_payouts");
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("id", "po1");
  });
});

describe("generatePayoutsForMonthCore", () => {
  function queueGenerate(
    q: ReturnType<typeof createMockSupabase>["queueResponse"],
    rows: unknown[],
    existing: unknown[],
  ) {
    q("profiles", PROFILE);          // role check
    q("profiles", PROFILE);          // requireActiveWorkspaceId
    q("extractions", { data: rows, error: null });
    q("partner_payouts", { data: existing, error: null });
  }

  it("refuses a caller without a payout role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(generatePayoutsForMonthCore({ month: "2026-09" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("totals each partner's activations and averages their rate", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    allowRole();
    queueGenerate(queueResponse, [
      { partner_id: "p1", commission_amount: 500 },
      { partner_id: "p1", commission_amount: 300 },
    ], []);
    queueResponse("partner_payouts", ok);

    const res = await generatePayoutsForMonthCore({ month: "2026-09" }, ctx(client));

    expect(res).toMatchObject({ created: 1, updated: 0, skipped: 0, total: 1, failed: [] });
    const row = getChain("partner_payouts", 1).upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({
      workspace_id: "ws1", partner_id: "p1",
      activations_count: 2, amount_pkr: 800, rate_pkr: 400, status: "pending",
    });
  });

  it("never touches a payout that has already been paid", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    allowRole();
    queueGenerate(queueResponse,
      [{ partner_id: "p1", commission_amount: 500 }],
      [{ partner_id: "p1", status: "paid" }]);
    // No upsert response queued — the mock throws if one is attempted, which is
    // the assertion: a settled payout must not be rewritten.

    const res = await generatePayoutsForMonthCore({ month: "2026-09" }, ctx(client));
    expect(res).toMatchObject({ created: 0, updated: 0, skipped: 1 });
  });

  it("counts a rewrite of a still-pending payout as an update", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    allowRole();
    queueGenerate(queueResponse,
      [{ partner_id: "p1", commission_amount: 500 }],
      [{ partner_id: "p1", status: "pending" }]);
    queueResponse("partner_payouts", ok);

    const res = await generatePayoutsForMonthCore({ month: "2026-09" }, ctx(client));
    expect(res).toMatchObject({ created: 0, updated: 1, skipped: 0 });
  });

  it("reports which partners failed instead of quietly counting them as nothing", async () => {
    // Regression: an error incremented nothing, so a run that failed half its
    // writes still returned a tidy set of counts with no way to tell.
    const { client, queueResponse, queueError, allowRole } = createMockSupabase();
    allowRole();
    queueGenerate(queueResponse, [
      { partner_id: "p1", commission_amount: 500 },
      { partner_id: "p2", commission_amount: 500 },
    ], []);
    queueError("partner_payouts", "write refused");
    queueResponse("partner_payouts", ok);

    const res = await generatePayoutsForMonthCore({ month: "2026-09" }, ctx(client));

    expect(res.total).toBe(2);
    expect(res.failed).toEqual([{ partner_id: "p1", error: "write refused" }]);
    expect(res.created + res.updated + res.skipped + res.failed.length).toBe(res.total);
  });

  it("does not divide by zero for a partner with no activations", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    allowRole();
    queueGenerate(queueResponse, [], []);

    const res = await generatePayoutsForMonthCore({ month: "2026-09" }, ctx(client));
    expect(res).toMatchObject({ created: 0, total: 0, failed: [] });
  });
});

describe("bulkMarkPayoutsPaidCore", () => {
  function queueBulk(
    q: ReturnType<typeof createMockSupabase>["queueResponse"],
    rows: unknown[],
  ) {
    q("profiles", PROFILE);
    q("profiles", PROFILE);
    // The bulk path derives its work from activations, not from existing
    // payout rows.
    q("extractions", { data: rows, error: null });
  }

  it("refuses a caller without a payout role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(bulkMarkPayoutsPaidCore({ month: "2026-09" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("reports failures rather than counting them as nothing", async () => {
    const { client, queueResponse, queueError, allowRole } = createMockSupabase();
    allowRole();
    queueBulk(queueResponse, [
      { partner_id: "p1", commission_amount: 100 },
      { partner_id: "p2", commission_amount: 100 },
    ]);
    queueError("partner_payouts", "locked");
    queueResponse("partner_payouts", ok);

    const res = await bulkMarkPayoutsPaidCore({ month: "2026-09" }, ctx(client));
    expect(res.failed).toEqual([{ partner_id: "p1", error: "locked" }]);
    expect(res.paid).toBe(1);
  });

  it("stamps this workspace on every row it writes", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    allowRole();
    queueBulk(queueResponse, [{ partner_id: "p1", commission_amount: 100 }]);
    queueResponse("partner_payouts", ok);

    await bulkMarkPayoutsPaidCore({ month: "2026-09" }, ctx(client));
    const row = getChain("partner_payouts", 0).upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({ workspace_id: "ws1", status: "paid", paid_by: "u1" });
  });
});
