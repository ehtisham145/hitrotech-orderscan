import { describe, it, expect } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";
import {
  getEmployeeUsageCore,
  listEmployeesCore,
  getEmployeeCore,
  upsertEmployeeCore,
  deleteEmployeeCore,
  getEmployeePerformanceCore,
  getEmployeeTeamPerformanceCore,
  listEmployeeAdvancesCore,
  upsertEmployeeAdvanceCore,
  settleEmployeeAdvanceCore,
  deleteEmployeeAdvanceCore,
  getEmployeeAdvancesSummaryCore,
} from "./employees.functions";

const PROFILE = { data: { active_workspace_id: "ws1" }, error: null };
const ctx = (client: unknown) => ({ supabase: client as never, userId: "u1" });

describe("getEmployeeUsageCore", () => {
  it("returns the used count against the plan's employee limit", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("employees", { data: null, error: null } as never); // count via head:true
    queueResponse("workspaces", { data: { plan_tier: "starter", plan_expires_at: null }, error: null });

    const usage = await getEmployeeUsageCore(ctx(client));

    expect(usage).toEqual({ used: 0, limit: 5, planTier: "starter" });
  });

  it("surfaces a count error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("employees", "count boom");
    await expect(getEmployeeUsageCore(ctx(client))).rejects.toThrow("count boom");
  });

  it("surfaces a workspace lookup error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("employees", { data: null, error: null } as never);
    queueError("workspaces", "ws boom");
    await expect(getEmployeeUsageCore(ctx(client))).rejects.toThrow("ws boom");
  });
});

describe("listEmployeesCore", () => {
  it("returns the workspace's employees, scoped by workspace_id", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("employees", { data: [{ id: "e1", name: "A" }], error: null });

    const rows = await listEmployeesCore(ctx(client));

    expect(rows).toEqual([{ id: "e1", name: "A" }]);
    expect(getChain("employees").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("returns an empty array rather than null", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("employees", { data: null, error: null });
    await expect(listEmployeesCore(ctx(client))).resolves.toEqual([]);
  });

  it("surfaces a query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("employees", "boom");
    await expect(listEmployeesCore(ctx(client))).rejects.toThrow("boom");
  });
});

describe("getEmployeeCore", () => {
  it("scopes the lookup to the caller's workspace", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("employees", { data: { id: "e1", name: "A" }, error: null });

    const row = await getEmployeeCore({ id: "e1" }, ctx(client));

    expect(row).toEqual({ id: "e1", name: "A" });
    const chain = getChain("employees");
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("id", "e1");
  });

  it("returns null for an id from another workspace instead of leaking it", async () => {
    // maybeSingle() returns null once the workspace_id filter excludes the row —
    // this is exactly the cross-tenant read the original unscoped query allowed.
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("employees", { data: null, error: null });
    await expect(getEmployeeCore({ id: "someone-elses" }, ctx(client))).resolves.toBeNull();
  });

  it("surfaces a query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("employees", "boom");
    await expect(getEmployeeCore({ id: "e1" }, ctx(client))).rejects.toThrow("boom");
  });
});

describe("upsertEmployeeCore — create", () => {
  const baseInput = { name: "New Hire", role: "bdo" as const };

  it("scopes the insert to the workspace and drops a null commission_per_activation", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("workspaces", { data: { plan_tier: "starter", plan_expires_at: null }, error: null });
    queueResponse("user_roles", { data: null, error: null }); // not a super admin
    queueResponse("employees", { data: null, error: null, count: 0 } as never); // count, head:true — well under the starter plan's limit of 5
    queueResponse("employees", { data: { id: "e1", ...baseInput }, error: null });

    const result = await upsertEmployeeCore({ ...baseInput, commission_per_activation: null }, ctx(client));

    expect(result.ok).toBe(true);
    const insertChain = getChain("employees", 1);
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ workspace_id: "ws1", name: "New Hire" }),
    );
    const inserted = insertChain.insert.mock.calls[0][0] as Record<string, unknown>;
    expect("commission_per_activation" in inserted).toBe(false);
  });

  it("refuses a caller without owner/admin/manager role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(upsertEmployeeCore(baseInput, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("blocks a new employee once the plan's limit is reached", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("workspaces", { data: { plan_tier: "free", plan_expires_at: null }, error: null });
    queueResponse("user_roles", { data: null, error: null });
    queueResponse("employees", { data: null, error: null, count: 1 } as never); // free plan limit is 1

    await expect(upsertEmployeeCore(baseInput, ctx(client)))
      .rejects.toThrow(/Plan limit reached/);
  });

  it("skips the limit check for a super admin even at the cap", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("workspaces", { data: { plan_tier: "free", plan_expires_at: null }, error: null });
    queueResponse("user_roles", { data: { role: "super_admin" }, error: null });
    queueResponse("employees", { data: { id: "e1", ...baseInput }, error: null });

    await expect(upsertEmployeeCore(baseInput, ctx(client))).resolves.toMatchObject({ ok: true });
    // Only the insert call touched "employees" — no count check was made.
    expect(() => getChain("employees", 1)).toThrow();
  });

  it("surfaces a workspace-lookup error during the limit check", async () => {
    const { client, queueResponse, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueError("workspaces", "ws boom");
    await expect(upsertEmployeeCore(baseInput, ctx(client))).rejects.toThrow("ws boom");
  });

  it("surfaces an insert error", async () => {
    const { client, queueResponse, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("workspaces", { data: { plan_tier: "starter", plan_expires_at: null }, error: null });
    queueResponse("user_roles", { data: null, error: null });
    queueResponse("employees", { data: null, error: null, count: 0 } as never);
    queueError("employees", "insert boom");
    await expect(upsertEmployeeCore(baseInput, ctx(client))).rejects.toThrow("insert boom");
  });
});

describe("upsertEmployeeCore — update", () => {
  it("scopes the update by workspace_id and id", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("employees", { data: { id: "e1", name: "Edited" }, error: null });

    await upsertEmployeeCore({ id: "e1", name: "Edited", role: "bdo" }, ctx(client));

    const chain = getChain("employees");
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("id", "e1");
  });

  it("fails loudly instead of reporting success when the id belongs to another workspace", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("employees", { data: null, error: null });

    await expect(upsertEmployeeCore({ id: "other-ws-employee", name: "X", role: "bdo" }, ctx(client)))
      .rejects.toThrow("Employee not found in this workspace");
  });

  it("refuses a caller without the write role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(upsertEmployeeCore({ id: "e1", name: "X", role: "bdo" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("surfaces an update error", async () => {
    const { client, queueResponse, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueError("employees", "update boom");
    await expect(upsertEmployeeCore({ id: "e1", name: "X", role: "bdo" }, ctx(client))).rejects.toThrow("update boom");
  });
});

describe("deleteEmployeeCore", () => {
  it("deletes only within the caller's workspace", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("employees", { data: null, error: null });

    await expect(deleteEmployeeCore({ id: "e1" }, ctx(client))).resolves.toEqual({ ok: true });

    const chain = getChain("employees");
    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("id", "e1");
  });

  it("refuses a caller without the write role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(deleteEmployeeCore({ id: "e1" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("surfaces a delete error", async () => {
    const { client, queueResponse, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueError("employees", "nope");
    await expect(deleteEmployeeCore({ id: "e1" }, ctx(client))).rejects.toThrow("nope");
  });
});

describe("getEmployeePerformanceCore", () => {
  it("scopes both the employee and activations lookups to the caller's workspace", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("employees", {
      data: {
        id: "e1",
        target_activations: 10,
        compensation_type: "fixed",
        salary: 50000,
        commission_per_activation: 0,
      },
      error: null,
    });
    queueResponse("extractions", {
      data: [
        { id: "x1", created_at: "2026-09-01T00:00:00Z", current_network: "Jazz" },
        { id: "x2", created_at: "2026-09-01T00:00:00Z", current_network: "Jazz" },
      ],
      error: null,
    });

    const result = await getEmployeePerformanceCore({ employeeId: "e1", month: "2026-09" }, ctx(client));

    expect(result.totalActivations).toBe(2);
    expect(result.attainment).toBe(20);
    expect(result.earnings.gross).toBe(50000);
    expect(getChain("employees").eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(getChain("extractions").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("surfaces an employee lookup error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("employees", "no such employee");
    queueResponse("extractions", { data: [], error: null }); // the two lookups run concurrently
    await expect(getEmployeePerformanceCore({ employeeId: "gone", month: "2026-09" }, ctx(client)))
      .rejects.toThrow("no such employee");
  });

  it("surfaces an activations query error instead of reporting zero activations", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("employees", {
      data: { id: "e1", target_activations: 10, compensation_type: "fixed", salary: 0, commission_per_activation: 0 },
      error: null,
    });
    queueError("extractions", "activations boom");

    await expect(getEmployeePerformanceCore({ employeeId: "e1", month: "2026-09" }, ctx(client)))
      .rejects.toThrow("activations boom");
  });
});

describe("getEmployeeTeamPerformanceCore", () => {
  it("scopes both queries to the workspace and only counts each member's own activations", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("employees", {
      data: [
        { id: "e1", target_activations: 5 },
        { id: "e2", target_activations: 10 },
      ],
      error: null,
    });
    queueResponse("extractions", {
      data: [
        { id: "x1", employee_id: "e1", created_at: "2026-09-01T00:00:00Z" },
        { id: "x2", employee_id: "e2", created_at: "2026-09-01T00:00:00Z" },
        { id: "x3", employee_id: "e2", created_at: "2026-09-01T00:00:00Z" },
      ],
      error: null,
    });

    const result = await getEmployeeTeamPerformanceCore({ managerId: "m1", month: "2026-09" }, ctx(client));

    expect(result.totalTeamActivations).toBe(3);
    // Sorted descending by activation count — e2 (2 activations) before e1 (1).
    expect(result.teamMembers.map((m: any) => m.id)).toEqual(["e2", "e1"]);
    expect(getChain("employees").eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(getChain("extractions").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("surfaces a team lookup error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("employees", "team boom");
    queueResponse("extractions", { data: [], error: null }); // the two lookups run concurrently
    await expect(getEmployeeTeamPerformanceCore({ managerId: "m1" }, ctx(client))).rejects.toThrow("team boom");
  });

  it("surfaces an activations query error instead of reporting an empty team", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("employees", { data: [{ id: "e1", target_activations: 5 }], error: null });
    queueError("extractions", "activations boom");
    await expect(getEmployeeTeamPerformanceCore({ managerId: "m1" }, ctx(client))).rejects.toThrow("activations boom");
  });
});

describe("listEmployeeAdvancesCore", () => {
  it("scopes to the caller's workspace and the given employee", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("employees_advances", { data: [{ id: "a1", amount: 1000 }], error: null });

    const rows = await listEmployeeAdvancesCore({ employeeId: "e1" }, ctx(client));

    expect(rows).toEqual([{ id: "a1", amount: 1000 }]);
    const chain = getChain("employees_advances");
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("employee_id", "e1");
  });

  it("surfaces a query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("employees_advances", "boom");
    await expect(listEmployeeAdvancesCore({ employeeId: "e1" }, ctx(client))).rejects.toThrow("boom");
  });
});

describe("upsertEmployeeAdvanceCore", () => {
  const baseInput = { employee_id: "e1", amount: 5000, payment_date: "2026-09-01" };

  it("creates an advance scoped to the workspace", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("employees_advances", { data: { id: "a1", ...baseInput }, error: null });

    await upsertEmployeeAdvanceCore(baseInput, ctx(client));

    expect(getChain("employees_advances").insert).toHaveBeenCalledWith(
      expect.objectContaining({ workspace_id: "ws1", employee_id: "e1", amount: 5000 }),
    );
  });

  it("scopes an update by workspace_id and id, not id alone", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("employees_advances", { data: { id: "a1", ...baseInput }, error: null });

    await upsertEmployeeAdvanceCore({ id: "a1", ...baseInput }, ctx(client));

    const chain = getChain("employees_advances");
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("id", "a1");
  });

  it("fails loudly when the advance id belongs to another workspace", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("employees_advances", { data: null, error: null });

    await expect(upsertEmployeeAdvanceCore({ id: "other-ws-advance", ...baseInput }, ctx(client)))
      .rejects.toThrow("Advance not found in this workspace");
  });

  it("refuses a caller without the write role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(upsertEmployeeAdvanceCore(baseInput, ctx(client))).rejects.toThrow(/Forbidden/);
  });
});

describe("settleEmployeeAdvanceCore", () => {
  it("scopes the settle update by workspace_id and id", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("employees_advances", { data: null, error: null });

    await expect(settleEmployeeAdvanceCore({ id: "a1", settled: true }, ctx(client))).resolves.toEqual({ ok: true });

    const chain = getChain("employees_advances");
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("id", "a1");
  });

  it("clears settled_at when un-settling", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("employees_advances", { data: null, error: null });

    await settleEmployeeAdvanceCore({ id: "a1", settled: false }, ctx(client));

    expect(getChain("employees_advances").update).toHaveBeenCalledWith(
      expect.objectContaining({ is_settled: false, settled_at: null }),
    );
  });

  it("refuses a caller without the write role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(settleEmployeeAdvanceCore({ id: "a1", settled: true }, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("surfaces an update error", async () => {
    const { client, queueResponse, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueError("employees_advances", "boom");
    await expect(settleEmployeeAdvanceCore({ id: "a1", settled: true }, ctx(client))).rejects.toThrow("boom");
  });
});

describe("deleteEmployeeAdvanceCore", () => {
  it("deletes only within the caller's workspace", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("employees_advances", { data: null, error: null });

    await expect(deleteEmployeeAdvanceCore({ id: "a1" }, ctx(client))).resolves.toEqual({ ok: true });

    const chain = getChain("employees_advances");
    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("id", "a1");
  });

  it("refuses a caller without the write role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(deleteEmployeeAdvanceCore({ id: "a1" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("surfaces a delete error", async () => {
    const { client, queueResponse, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueError("employees_advances", "boom");
    await expect(deleteEmployeeAdvanceCore({ id: "a1" }, ctx(client))).rejects.toThrow("boom");
  });
});

describe("getEmployeeAdvancesSummaryCore", () => {
  it("totals amount vs repayment, scoped to the workspace", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("employees_advances", {
      data: [
        { amount: 5000, repayment_amount: 2000, is_settled: false },
        { amount: 3000, repayment_amount: 3000, is_settled: true },
      ],
      error: null,
    });

    const summary = await getEmployeeAdvancesSummaryCore({ employeeId: "e1" }, ctx(client));

    expect(summary).toEqual({ total: 8000, repaid: 5000, pending: 3000, count: 2, activeCount: 1 });
    const chain = getChain("employees_advances");
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("employee_id", "e1");
  });

  it("never reports negative pending even if repayments exceed the total", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("employees_advances", {
      data: [{ amount: 1000, repayment_amount: 5000, is_settled: true }],
      error: null,
    });

    const summary = await getEmployeeAdvancesSummaryCore({ employeeId: "e1" }, ctx(client));
    expect(summary.pending).toBe(0);
  });

  it("handles an empty advances list", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("employees_advances", { data: null, error: null });

    await expect(getEmployeeAdvancesSummaryCore({ employeeId: "e1" }, ctx(client)))
      .resolves.toEqual({ total: 0, repaid: 0, pending: 0, count: 0, activeCount: 0 });
  });

  it("surfaces a query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("employees_advances", "boom");
    await expect(getEmployeeAdvancesSummaryCore({ employeeId: "e1" }, ctx(client))).rejects.toThrow("boom");
  });
});
