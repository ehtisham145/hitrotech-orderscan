import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";

// exportMonthlyBackupCore dynamically imports the privileged admin client
// for the storage upload/sign + generated_reports insert.
let adminMock = createMockSupabase();
vi.mock("@/integrations/supabase/ext-client.server", () => ({
  get supabaseAdmin() {
    return adminMock.client;
  },
}));

import {
  listAuditLogsCore,
  listAnomaliesCore,
  listMonthLocksCore,
  isMonthLockedCore,
  lockMonthCore,
  unlockMonthCore,
  listMonthLockHistoryCore,
  getReconciliationCore,
  exportMonthlyBackupCore,
} from "./reliability.functions";

const PROFILE = { data: { active_workspace_id: "ws1" }, error: null };
const ctx = (client: unknown) => ({ supabase: client as never, userId: "u1" });

beforeEach(() => {
  adminMock = createMockSupabase();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("listAuditLogsCore", () => {
  it("scopes to the caller's workspace and resolves actor emails", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("audit_logs", { data: [{ id: "a1", user_id: "u2", action: "x", entity_type: "y", entity_id: null, created_at: "2026-01-01" }], error: null });
    queueResponse("profiles", { data: [{ id: "u2", email: "u2@x.com" }], error: null });

    const rows = await listAuditLogsCore({}, ctx(client));

    expect(rows).toEqual([expect.objectContaining({ id: "a1", actor_email: "u2@x.com" })]);
    expect(getChain("audit_logs").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("applies entity_type and entity_id filters when given", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("audit_logs", { data: [], error: null });

    await listAuditLogsCore({ entity_type: "batch", entity_id: "b1" }, ctx(client));

    const chain = getChain("audit_logs");
    expect(chain.eq).toHaveBeenCalledWith("entity_type", "batch");
    expect(chain.eq).toHaveBeenCalledWith("entity_id", "b1");
  });

  it("surfaces a query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("audit_logs", "boom");
    await expect(listAuditLogsCore({}, ctx(client))).rejects.toThrow("boom");
  });

  it("surfaces a profile-lookup error instead of leaving actor_email blank", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("audit_logs", { data: [{ id: "a1", user_id: "u2", action: "x", entity_type: "y", entity_id: null, created_at: "t" }], error: null });
    queueError("profiles", "prof boom");
    await expect(listAuditLogsCore({}, ctx(client))).rejects.toThrow("prof boom");
  });
});

describe("listAnomaliesCore", () => {
  it("merges DB-flagged rows with repeat-phone detections", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("extractions", {
      data: [{ id: "x1", phone_number: "03001234567", created_at: "2026-09-02", anomalies: ["manual_flag"] }],
      error: null,
    });
    queueResponse("extractions", {
      data: [
        { id: "x1", phone_number: "03001234567", created_at: "2026-09-02", anomalies: ["manual_flag"] },
        { id: "x2", phone_number: "03001234567", created_at: "2026-09-01", anomalies: [] },
      ],
      error: null,
    });

    const result = await listAnomaliesCore({ month: "2026-09" }, ctx(client));

    expect(result.rows).toHaveLength(2);
    const x1 = result.rows.find((r: any) => r.id === "x1")!;
    expect(x1.anomalies.sort()).toEqual(["manual_flag", "repeat_phone_this_month"]);
    const x2 = result.rows.find((r: any) => r.id === "x2")!;
    expect(x2.anomalies).toEqual(["repeat_phone_this_month"]);
  });

  it("surfaces the flagged-rows query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("extractions", "boom");
    await expect(listAnomaliesCore({}, ctx(client))).rejects.toThrow("boom");
  });

  it("surfaces the repeat-phone scan's error instead of reporting no repeats", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("extractions", { data: [], error: null });
    queueError("extractions", "pool boom");
    await expect(listAnomaliesCore({}, ctx(client))).rejects.toThrow("pool boom");
  });
});

describe("listMonthLocksCore", () => {
  it("scopes the list to the caller's workspace", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("month_locks", { data: [{ month: "2026-09-01" }], error: null });

    const rows = await listMonthLocksCore(ctx(client));
    expect(rows).toEqual([{ month: "2026-09-01" }]);
    expect(getChain("month_locks").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("surfaces a query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("month_locks", "boom");
    await expect(listMonthLocksCore(ctx(client))).rejects.toThrow("boom");
  });
});

describe("isMonthLockedCore", () => {
  it("reports unlocked when there is no matching row in this workspace", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("month_locks", { data: null, error: null });

    const result = await isMonthLockedCore({ month: "2026-09" }, ctx(client));
    expect(result).toEqual({ locked: false, row: null });
    expect(getChain("month_locks").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("resolves the locking user's display name", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("month_locks", { data: { month: "2026-09-01", locked_at: "t", locked_by: "u2", notes: null }, error: null });
    queueResponse("profiles", { data: { full_name: "Jane", email: "jane@x.com" }, error: null });

    const result = await isMonthLockedCore({ month: "2026-09" }, ctx(client));
    expect(result.locked).toBe(true);
    expect(result.row?.locked_by_name).toBe("Jane");
  });

  it("surfaces the lock query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("month_locks", "boom");
    await expect(isMonthLockedCore({ month: "2026-09" }, ctx(client))).rejects.toThrow("boom");
  });
});

describe("lockMonthCore", () => {
  it("upserts scoped to the workspace and writes an audit row", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("month_locks", { data: null, error: null });
    queueResponse("audit_logs", { data: null, error: null });

    await expect(lockMonthCore({ month: "2026-09" }, ctx(client))).resolves.toEqual({ ok: true });
    expect(getChain("month_locks").upsert).toHaveBeenCalledWith(
      expect.objectContaining({ workspace_id: "ws1", month: "2026-09-01" }),
      { onConflict: "workspace_id,month" },
    );
  });

  it("refuses a caller without the owner/admin role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(lockMonthCore({ month: "2026-09" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("surfaces the upsert error", async () => {
    const { client, queueResponse, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueError("month_locks", "boom");
    await expect(lockMonthCore({ month: "2026-09" }, ctx(client))).rejects.toThrow("boom");
  });

  it("still succeeds when the lock worked but the audit write failed", async () => {
    const { client, queueResponse, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("month_locks", { data: null, error: null });
    queueError("audit_logs", "audit boom");
    await expect(lockMonthCore({ month: "2026-09" }, ctx(client))).resolves.toEqual({ ok: true });
  });
});

describe("unlockMonthCore", () => {
  it("deletes scoped to the workspace", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("month_locks", { data: null, error: null });
    queueResponse("audit_logs", { data: null, error: null });

    await expect(unlockMonthCore({ month: "2026-09" }, ctx(client))).resolves.toEqual({ ok: true });
    const chain = getChain("month_locks");
    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("refuses a caller without the owner/admin role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(unlockMonthCore({ month: "2026-09" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("surfaces the delete error", async () => {
    const { client, queueResponse, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueError("month_locks", "boom");
    await expect(unlockMonthCore({ month: "2026-09" }, ctx(client))).rejects.toThrow("boom");
  });
});

describe("listMonthLockHistoryCore", () => {
  it("scopes to the workspace and resolves actor names", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("audit_logs", {
      data: [{ id: "a1", user_id: "u2", action: "month.locked", details: { month: "2026-09-01" }, created_at: "t" }],
      error: null,
    });
    queueResponse("profiles", { data: [{ id: "u2", full_name: "Jane", email: "j@x.com" }], error: null });

    const rows = await listMonthLockHistoryCore({}, ctx(client));
    expect(rows).toEqual([{ id: "a1", action: "month.locked", created_at: "t", actor_name: "Jane", month: "2026-09-01", notes: null }]);
    expect(getChain("audit_logs").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("surfaces a query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("audit_logs", "boom");
    await expect(listMonthLockHistoryCore({}, ctx(client))).rejects.toThrow("boom");
  });

  it("surfaces a profile-lookup error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("audit_logs", { data: [{ id: "a1", user_id: "u2", action: "month.locked", details: {}, created_at: "t" }], error: null });
    queueError("profiles", "boom");
    await expect(listMonthLockHistoryCore({}, ctx(client))).rejects.toThrow("boom");
  });
});

describe("getReconciliationCore", () => {
  it("computes deltas between snapshot and live totals, dropping matched rows", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partner_payouts", {
      data: [
        { partner_id: "p1", snapshot_count: 5, snapshot_amount: 500, status: "paid", snapshot_at: "t" },
        { partner_id: "p2", snapshot_count: 2, snapshot_amount: 200, status: "paid", snapshot_at: "t" },
      ],
      error: null,
    });
    queueResponse("extractions", {
      data: [
        { partner_id: "p1", commission_amount: 150 },
        { partner_id: "p1", commission_amount: 150 },
        { partner_id: "p2", commission_amount: 100 },
        { partner_id: "p2", commission_amount: 100 },
      ],
      error: null,
    });
    queueResponse("partners", { data: [{ id: "p1", name: "Alpha" }, { id: "p2", name: "Beta" }], error: null });

    const result = await getReconciliationCore({ month: "2026-09" }, ctx(client));

    // p1: live 2/300 vs snapshot 5/500 -> mismatched, included
    // p2: live 2/200 vs snapshot 2/200 -> matched exactly, dropped
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ partner_id: "p1", name: "Alpha", live_count: 2, delta_count: -3, delta_amount: -200 });
  });

  it("surfaces a payouts query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("partner_payouts", "boom");
    queueResponse("extractions", { data: [], error: null });
    queueResponse("partners", { data: [], error: null });
    await expect(getReconciliationCore({ month: "2026-09" }, ctx(client))).rejects.toThrow("boom");
  });

  it("surfaces an extractions query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partner_payouts", { data: [], error: null });
    queueError("extractions", "boom");
    queueResponse("partners", { data: [], error: null });
    await expect(getReconciliationCore({ month: "2026-09" }, ctx(client))).rejects.toThrow("boom");
  });

  it("surfaces a partners query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partner_payouts", { data: [], error: null });
    queueResponse("extractions", { data: [], error: null });
    queueError("partners", "boom");
    await expect(getReconciliationCore({ month: "2026-09" }, ctx(client))).rejects.toThrow("boom");
  });
});

describe("exportMonthlyBackupCore", () => {
  const queueAllOk = (queueResponse: ReturnType<typeof createMockSupabase>["queueResponse"]) => {
    queueResponse("extractions", { data: [{ id: "x1", batch_id: "b1", status: "success", order_number: "O1", customer_name: "C", phone_number: "P", cnic: null, store_id: "s1", reference: null, employee_name: "E", branch_name: "B", activation_date: "d", plan_price: 100, is_duplicate: false, needs_review: false, anomalies: [], partner_id: null, commission_amount: 0, commission_month: "2026-09-01", created_at: "t" }], error: null });
    queueResponse("partner_payouts", { data: [], error: null });
    queueResponse("partners", { data: [], error: null });
    queueResponse("batches", { data: [{ id: "b1", name: "Batch 1", created_at: "t" }], error: null });
    queueResponse("commission_slabs", { data: [], error: null });
  };

  it("exports, uploads, records the report, and returns a signed url", async () => {
    const { client, queueResponse, queueRpc } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueRpc("is_manager_or_admin", { data: true, error: null });
    queueAllOk(queueResponse);
    queueResponse("profiles", PROFILE); // requireActiveWorkspaceId again for the report record

    adminMock.createSignedUploadUrl.mockResolvedValue({ data: null, error: null }); // unused but present
    (adminMock.client.storage.from as unknown as (b: string) => unknown) = () => ({
      upload: vi.fn().mockResolvedValue({ error: null }),
      createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null }),
    });
    adminMock.queueResponse("generated_reports", { data: null, error: null });

    const result = await exportMonthlyBackupCore({ month: "2026-09" }, ctx(client));

    expect(result.url).toBe("https://signed.example/x");
    expect(result.counts).toEqual({ extractions: 1, payouts: 0, partners: 0 });
  });

  it("refuses a caller the rpc says isn't manager/admin", async () => {
    const { client, queueResponse, queueRpc } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueRpc("is_manager_or_admin", { data: false, error: null });
    await expect(exportMonthlyBackupCore({ month: "2026-09" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("surfaces the manager/admin rpc's own error", async () => {
    const { client, queueResponse, queueRpc } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueRpc("is_manager_or_admin", { data: null, error: { message: "rpc boom" } });
    await expect(exportMonthlyBackupCore({ month: "2026-09" }, ctx(client))).rejects.toThrow("rpc boom");
  });

  it("surfaces an extractions query error instead of shipping an incomplete backup", async () => {
    const { client, queueResponse, queueRpc, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueRpc("is_manager_or_admin", { data: true, error: null });
    queueError("extractions", "ext boom");
    queueResponse("partner_payouts", { data: [], error: null });
    queueResponse("partners", { data: [], error: null });
    queueResponse("batches", { data: [], error: null });
    queueResponse("commission_slabs", { data: [], error: null });

    await expect(exportMonthlyBackupCore({ month: "2026-09" }, ctx(client))).rejects.toThrow("ext boom");
  });

  it("throws if the storage upload fails", async () => {
    const { client, queueResponse, queueRpc } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueRpc("is_manager_or_admin", { data: true, error: null });
    queueAllOk(queueResponse);

    (adminMock.client.storage.from as unknown as (b: string) => unknown) = () => ({
      upload: vi.fn().mockResolvedValue({ error: { message: "upload boom" } }),
      createSignedUrl: vi.fn(),
    });

    await expect(exportMonthlyBackupCore({ month: "2026-09" }, ctx(client))).rejects.toThrow("upload boom");
  });

  it("still returns the signed url when the generated_reports insert fails", async () => {
    const { client, queueResponse, queueRpc } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueRpc("is_manager_or_admin", { data: true, error: null });
    queueAllOk(queueResponse);
    queueResponse("profiles", PROFILE);

    (adminMock.client.storage.from as unknown as (b: string) => unknown) = () => ({
      upload: vi.fn().mockResolvedValue({ error: null }),
      createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null }),
    });
    adminMock.queueError("generated_reports", "report boom");

    await expect(exportMonthlyBackupCore({ month: "2026-09" }, ctx(client))).resolves.toMatchObject({ url: "https://signed.example/x" });
  });
});
