import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";

// runMonthClose does its own multi-table read/write cycle (extractions,
// partner_payouts, brand_invoices, ...) — out of scope for this file, and
// already exercised wherever month-close.server.ts itself is tested. Mocked
// here so these tests are only about the thin wrapper: role check, passing
// the right args through, and what happens to the audit-log write.
// monthStartOf is a pure one-liner and is kept real via importActual.
const runMonthCloseMock = vi.fn();
vi.mock("./month-close.server", async (importActual) => {
  const actual = await importActual<typeof import("./month-close.server")>();
  return { ...actual, runMonthClose: (...args: unknown[]) => runMonthCloseMock(...args) };
});

import {
  getMonthCloseCore,
  listMonthClosesCore,
  closeMonthNowCore,
  reopenMonthCore,
} from "./month-close.functions";

const PROFILE = { data: { active_workspace_id: "ws1" }, error: null };
const ctx = (client: unknown) => ({ supabase: client as never, userId: "u1" });

beforeEach(() => {
  runMonthCloseMock.mockReset();
});

describe("getMonthCloseCore", () => {
  it("normalises the month and scopes both lookups to the workspace", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("month_closes", { data: { id: "mc1", month: "2026-09-01" }, error: null });
    queueResponse("month_locks", { data: null, error: null });

    const result = await getMonthCloseCore({ month: "2026-09-15" }, ctx(client));

    expect(result).toEqual({ month: "2026-09-01", close: { id: "mc1", month: "2026-09-01" }, locked: false });
    expect(getChain("month_closes").eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(getChain("month_locks").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("reports locked: true when a lock row exists", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("month_closes", { data: null, error: null });
    queueResponse("month_locks", { data: { id: "lock1" }, error: null });

    const result = await getMonthCloseCore({ month: "2026-09" }, ctx(client));
    expect(result.locked).toBe(true);
  });

  it("surfaces a month_closes query error instead of reporting no close record", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("month_closes", "boom");
    queueResponse("month_locks", { data: null, error: null });
    await expect(getMonthCloseCore({ month: "2026-09" }, ctx(client))).rejects.toThrow("boom");
  });

  it("surfaces a month_locks query error instead of reporting the month as unlocked", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("month_closes", { data: null, error: null });
    queueError("month_locks", "lock boom");
    await expect(getMonthCloseCore({ month: "2026-09" }, ctx(client))).rejects.toThrow("lock boom");
  });
});

describe("listMonthClosesCore", () => {
  it("scopes the list to the workspace, most recent month first", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("month_closes", { data: [{ id: "mc1", month: "2026-09-01" }], error: null });

    const rows = await listMonthClosesCore(ctx(client));

    expect(rows).toEqual([{ id: "mc1", month: "2026-09-01" }]);
    expect(getChain("month_closes").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("returns an empty array rather than null", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("month_closes", { data: null, error: null });
    await expect(listMonthClosesCore(ctx(client))).resolves.toEqual([]);
  });

  it("surfaces a query error instead of reporting an empty history", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("month_closes", "boom");
    await expect(listMonthClosesCore(ctx(client))).rejects.toThrow("boom");
  });
});

describe("closeMonthNowCore", () => {
  const CLOSE_RESULT = {
    month: "2026-09-01",
    workspace_id: "ws1",
    activations: 10,
    partner_cost: 5000,
    brand_revenue: 8000,
    margin: 3000,
    payouts_created: 2,
  };

  it("runs the close, writes an audit row, and reports the result", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    runMonthCloseMock.mockResolvedValue(CLOSE_RESULT);
    queueResponse("audit_logs", { data: null, error: null });

    const result = await closeMonthNowCore({ month: "2026-09" }, ctx(client));

    expect(result).toEqual({ ok: true, ...CLOSE_RESULT });
    expect(runMonthCloseMock).toHaveBeenCalledWith(
      expect.anything(),
      "ws1",
      "2026-09",
      { closedBy: "u1", automatic: false, lock: true },
    );
    expect(getChain("audit_logs").insert).toHaveBeenCalledWith(
      expect.objectContaining({ workspace_id: "ws1", action: "month.closed" }),
    );
  });

  it("passes lock: false through when the caller opts out of locking", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    runMonthCloseMock.mockResolvedValue(CLOSE_RESULT);
    queueResponse("audit_logs", { data: null, error: null });

    await closeMonthNowCore({ month: "2026-09", lock: false }, ctx(client));

    expect(runMonthCloseMock).toHaveBeenCalledWith(
      expect.anything(),
      "ws1",
      "2026-09",
      expect.objectContaining({ lock: false }),
    );
  });

  it("refuses a caller without the owner/admin role, without ever running the close", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(closeMonthNowCore({ month: "2026-09" }, ctx(client))).rejects.toThrow(/Forbidden/);
    expect(runMonthCloseMock).not.toHaveBeenCalled();
  });

  it("still reports success when the close itself succeeded but the audit-log write failed", async () => {
    // The close already happened by the time the audit write runs — failing
    // the whole call here would tell the caller a real close didn't happen.
    const { client, queueResponse, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    runMonthCloseMock.mockResolvedValue(CLOSE_RESULT);
    queueError("audit_logs", "audit boom");

    await expect(closeMonthNowCore({ month: "2026-09" }, ctx(client))).resolves.toEqual({ ok: true, ...CLOSE_RESULT });
  });

  it("surfaces a genuine close failure", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    runMonthCloseMock.mockRejectedValue(new Error("close boom"));
    await expect(closeMonthNowCore({ month: "2026-09" }, ctx(client))).rejects.toThrow("close boom");
  });
});

describe("reopenMonthCore", () => {
  it("reopens the month and writes an audit row", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("month_closes", { data: null, error: null });
    queueResponse("month_locks", { data: null, error: null });
    queueResponse("audit_logs", { data: null, error: null });

    await expect(reopenMonthCore({ month: "2026-09" }, ctx(client))).resolves.toEqual({ ok: true });

    expect(getChain("month_closes").update).toHaveBeenCalledWith({ status: "open" });
    expect(getChain("month_closes").eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(getChain("month_locks").delete).toHaveBeenCalled();
    expect(getChain("month_locks").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("refuses a caller without the owner/admin role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(reopenMonthCore({ month: "2026-09" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("fails instead of reporting success when the month_closes update errors", async () => {
    const { client, queueResponse, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueError("month_closes", "update boom");
    await expect(reopenMonthCore({ month: "2026-09" }, ctx(client))).rejects.toThrow("update boom");
  });

  it("fails instead of reporting success when the month_locks delete errors", async () => {
    const { client, queueResponse, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("month_closes", { data: null, error: null });
    queueError("month_locks", "lock delete boom");
    await expect(reopenMonthCore({ month: "2026-09" }, ctx(client))).rejects.toThrow("lock delete boom");
  });

  it("still reports success when the reopen itself succeeded but the audit-log write failed", async () => {
    const { client, queueResponse, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("month_closes", { data: null, error: null });
    queueResponse("month_locks", { data: null, error: null });
    queueError("audit_logs", "audit boom");

    await expect(reopenMonthCore({ month: "2026-09" }, ctx(client))).resolves.toEqual({ ok: true });
  });
});
