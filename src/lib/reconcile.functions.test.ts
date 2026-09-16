import { describe, it, expect } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";
import {
  getPaymentLedgerCore,
  recordPayoutPaymentCore,
  deletePayoutPaymentCore,
  recordBrandReceiptCore,
  deleteBrandReceiptCore,
  listReceiptBrandsCore,
} from "./reconcile.functions";

const PROFILE = { data: { active_workspace_id: "ws1" }, error: null };
const ctx = (client: unknown) => ({ supabase: client as never, userId: "u1" });
const ok = { data: null, error: null };

/** The five parallel reads the ledger starts with, in order. */
function queueLedger(
  q: ReturnType<typeof createMockSupabase>["queueResponse"],
  o: { rows?: unknown[]; partners?: unknown[]; payments?: unknown[]; invoice?: unknown; receipts?: unknown[] } = {},
) {
  q("profiles", PROFILE);
  q("extractions", { data: o.rows ?? [], error: null });
  q("partners", { data: o.partners ?? [], error: null });
  q("payout_payments", { data: o.payments ?? [], error: null });
  q("brand_invoices", { data: o.invoice ?? null, error: null });
  q("brand_receipts", { data: o.receipts ?? [], error: null });
}

describe("getPaymentLedgerCore", () => {
  it("scopes every one of its five queries to the caller's workspace", async () => {
    // Regression: none of them filtered on workspace_id, so the ledger was
    // assembled from every tenant's rows with RLS as the only guard.
    const { client, queueResponse, getChain } = createMockSupabase();
    queueLedger(queueResponse);

    await getPaymentLedgerCore({ month: "2026-09" }, ctx(client));

    for (const t of ["extractions", "partners", "payout_payments", "brand_invoices", "brand_receipts"]) {
      expect(getChain(t).eq).toHaveBeenCalledWith("workspace_id", "ws1");
    }
  });

  it("normalises a bare YYYY-MM input (no day component) correctly", async () => {
    // Regression guard: monthStart used to build this via
    // `input.slice(0, 8) + "01"`, valid only for a 10-char "YYYY-MM-DD"
    // input — a 7-char "YYYY-MM" input came out as "2026-0901", invalid.
    const { client, queueResponse } = createMockSupabase();
    queueLedger(queueResponse);
    const res = await getPaymentLedgerCore({ month: "2026-09" }, ctx(client));
    expect(res.month).toBe("2026-09-01");
  });

  it("refuses to report a quiet month when a source query failed", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("extractions", { data: [], error: null });
    queueResponse("partners", { data: [], error: null });
    queueError("payout_payments", "ledger unavailable");
    queueResponse("brand_invoices", { data: null, error: null });
    queueResponse("brand_receipts", { data: [], error: null });

    await expect(getPaymentLedgerCore({ month: "2026-09" }, ctx(client)))
      .rejects.toThrow(/Could not load payments.*ledger unavailable/);
  });

  it("nets what a partner is owed against what they have been paid", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueLedger(queueResponse, {
      rows: [
        { partner_id: "p1", commission_amount: 500 },
        { partner_id: "p1", commission_amount: 500 },
      ],
      partners: [{ id: "p1", name: "Ali", role: "retailer" }],
      payments: [{ partner_id: "p1", amount_pkr: 400, paid_on: "2026-09-10" }],
    });

    const res = await getPaymentLedgerCore({ month: "2026-09" }, ctx(client));

    expect(res.rows[0]).toMatchObject({
      partner_id: "p1", name: "Ali", count: 2,
      owed: 1000, paid: 400, outstanding: 600, status: "partial",
      last_paid_on: "2026-09-10",
    });
  });

  it("labels each partner's settlement state", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueLedger(queueResponse, {
      rows: [
        { partner_id: "unpaid", commission_amount: 100 },
        { partner_id: "settled", commission_amount: 100 },
        { partner_id: "over", commission_amount: 100 },
      ],
      partners: [],
      payments: [
        { partner_id: "settled", amount_pkr: 100, paid_on: "2026-09-01" },
        { partner_id: "over", amount_pkr: 250, paid_on: "2026-09-01" },
      ],
    });

    const res = await getPaymentLedgerCore({ month: "2026-09" }, ctx(client));
    const byId = Object.fromEntries(res.rows.map((r) => [r.partner_id, r.status]));
    expect(byId).toEqual({ unpaid: "unpaid", settled: "settled", over: "overpaid" });
  });

  it("keeps the latest payment date, not merely the last row read", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueLedger(queueResponse, {
      rows: [{ partner_id: "p1", commission_amount: 100 }],
      payments: [
        { partner_id: "p1", amount_pkr: 50, paid_on: "2026-09-20" },
        { partner_id: "p1", amount_pkr: 50, paid_on: "2026-09-05" },
      ],
    });

    const res = await getPaymentLedgerCore({ month: "2026-09" }, ctx(client));
    expect(res.rows[0].last_paid_on).toBe("2026-09-20");
    expect(res.rows[0].paid).toBe(100);
  });

  it("still lists a partner who was paid for a month they are owed nothing in", async () => {
    // Paid-but-not-owed is exactly the overpayment a reconciliation is for; it
    // must not drop out of the ledger.
    const { client, queueResponse } = createMockSupabase();
    queueLedger(queueResponse, {
      rows: [],
      payments: [{ partner_id: "ghost", amount_pkr: 300, paid_on: "2026-09-02" }],
    });

    const res = await getPaymentLedgerCore({ month: "2026-09" }, ctx(client));
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ partner_id: "ghost", name: "Unknown", owed: 0, paid: 300, status: "overpaid" });
  });

  it("totals the brand side and reports what is still outstanding on it", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueLedger(queueResponse, {
      invoice: { id: "i1", brand_id: "b1", amount_pkr: 10000 },
      receipts: [{ amount_pkr: 4000 }, { amount_pkr: 1000 }],
    });

    const res = await getPaymentLedgerCore({ month: "2026-09" }, ctx(client));
    expect(res.brand).toMatchObject({ brand_id: "b1", invoice_id: "i1", invoiced: 10000, received: 5000, outstanding: 5000 });
  });

  it("reports an empty month as zeros rather than NaN", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueLedger(queueResponse);

    const res = await getPaymentLedgerCore({ month: "2026-09" }, ctx(client));
    expect(res.rows).toEqual([]);
    expect(res.totals).toMatchObject({ owed: 0, paid: 0, outstanding: 0, activations: 0 });
    expect(res.net_position).toBe(0);
    expect(res.brand).toMatchObject({ invoiced: 0, received: 0, outstanding: 0 });
  });
});

const PAYMENT = { partner_id: "p1", month: "2026-09", amount_pkr: 500 };

describe("recordPayoutPaymentCore", () => {
  it("refuses a caller without owner/admin", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(recordPayoutPaymentCore(PAYMENT, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("rejects a zero or negative amount before writing", async () => {
    for (const amount of [0, -1]) {
      const { client, queueResponse, allowRole } = createMockSupabase();
      queueResponse("profiles", PROFILE);
      allowRole();
      await expect(recordPayoutPaymentCore({ ...PAYMENT, amount_pkr: amount }, ctx(client)))
        .resolves.toEqual({ ok: false, error: "Amount must be greater than zero" });
    }
  });

  it("stamps the workspace, the author, and normalises the month", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("payout_payments", ok);

    await expect(recordPayoutPaymentCore({ ...PAYMENT, month: "2026-09-27" }, ctx(client)))
      .resolves.toEqual({ ok: true });

    const row = getChain("payout_payments").insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({
      workspace_id: "ws1", created_by: "u1", partner_id: "p1",
      month: "2026-09-01", amount_pkr: 500, method: "bank",
    });
  });
});

describe("deletePayoutPaymentCore", () => {
  it("deletes only within the caller's workspace", async () => {
    // Regression: assertActiveWorkspaceRole's return was discarded and the
    // delete matched on id alone.
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("payout_payments", { data: [{ id: "pay1" }], error: null });

    await expect(deletePayoutPaymentCore({ id: "pay1" }, ctx(client))).resolves.toEqual({ ok: true });
    const chain = getChain("payout_payments");
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("id", "pay1");
  });

  it("reports a delete that matched nothing", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("payout_payments", { data: [], error: null });

    await expect(deletePayoutPaymentCore({ id: "other-ws" }, ctx(client)))
      .resolves.toEqual({ ok: false, error: "Payment not found in this workspace" });
  });

  it("refuses a caller without owner/admin", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(deletePayoutPaymentCore({ id: "pay1" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });
});

describe("recordBrandReceiptCore / deleteBrandReceiptCore", () => {
  const RECEIPT = { brand_id: "b1", month: "2026-09", amount_pkr: 4000 };

  it("rejects a zero amount", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    await expect(recordBrandReceiptCore({ ...RECEIPT, amount_pkr: 0 }, ctx(client)))
      .resolves.toEqual({ ok: false, error: "Amount must be greater than zero" });
  });

  it("stamps the workspace and normalises the month", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("brand_receipts", ok);

    await recordBrandReceiptCore({ ...RECEIPT, month: "2026-09-27" }, ctx(client));
    const row = getChain("brand_receipts").insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({ workspace_id: "ws1", created_by: "u1", month: "2026-09-01", brand_id: "b1" });
  });

  it("delete is scoped to the workspace and reports a miss", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("brand_receipts", { data: [], error: null });

    await expect(deleteBrandReceiptCore({ id: "r1" }, ctx(client)))
      .resolves.toEqual({ ok: false, error: "Receipt not found in this workspace" });
    expect(getChain("brand_receipts").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });
});

describe("listReceiptBrandsCore", () => {
  it("lists only the caller's workspace's brands", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("brands", { data: [{ id: "b1", name: "Onic", active: true }], error: null });

    await expect(listReceiptBrandsCore(ctx(client))).resolves.toHaveLength(1);
    expect(getChain("brands").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });
});
