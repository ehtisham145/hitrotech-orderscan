import { describe, it, expect } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";
import { getActivationUsageCore, checkActivationBudgetCore } from "./usage.functions";

const PROFILE = { data: { active_workspace_id: "ws1" }, error: null };
const ctx = (client: unknown) => ({ supabase: client as never, userId: "u1" });

// A workspace on the "free" plan (activationsPerMonth: 500), activated well
// in the past so "now" always falls inside its current 30-day period.
const WS_FREE = { plan_tier: "free", plan_activated_at: "2020-01-01T00:00:00Z", plan_expires_at: null, created_at: "2020-01-01T00:00:00Z" };

describe("getActivationUsageCore", () => {
  it("reports usage against the plan's limit", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("user_roles", { data: null, error: null }); // not super admin
    queueResponse("workspaces", { data: WS_FREE, error: null });
    queueResponse("extractions", { data: null, error: null, count: 10 } as never);

    const result = await getActivationUsageCore(ctx(client));

    expect(result.used).toBe(10);
    expect(result.limit).toBe(500);
    expect(result.remaining).toBe(490);
    expect(result.planExpired).toBe(false);
  });

  it("grants unlimited usage to a super admin inside their own workspace", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("user_roles", { data: { role: "super_admin" }, error: null });
    queueResponse("workspace_members", { data: { workspace_id: "ws1" }, error: null });
    queueResponse("workspaces", { data: WS_FREE, error: null });
    queueResponse("extractions", { data: null, error: null, count: 999999 } as never);

    const result = await getActivationUsageCore(ctx(client));
    expect(result.limit).toBeNull();
    expect(result.remaining).toBeNull();
  });

  it("does not grant unlimited usage to a super admin outside their own workspace", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("user_roles", { data: { role: "super_admin" }, error: null });
    queueResponse("workspace_members", { data: null, error: null }); // not a member here
    queueResponse("workspaces", { data: WS_FREE, error: null });
    queueResponse("extractions", { data: null, error: null, count: 10 } as never);

    const result = await getActivationUsageCore(ctx(client));
    expect(result.limit).toBe(500);
  });

  it("fails instead of resetting the billing period anchor when the workspace lookup errors", async () => {
    // Regression guard: this used to discard the error and silently anchor
    // the 30-day window to "right now" instead of the workspace's real
    // plan_activated_at/created_at.
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("user_roles", { data: null, error: null });
    queueError("workspaces", "ws boom");
    await expect(getActivationUsageCore(ctx(client))).rejects.toThrow("ws boom");
  });

  it("fails instead of reporting zero usage when the activation count query errors", async () => {
    // Regression guard: this is the serious one — a failed count query used
    // to default `used` to 0, which would make checkActivationBudgetCore
    // always pass regardless of the workspace's real usage.
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("user_roles", { data: null, error: null });
    queueResponse("workspaces", { data: WS_FREE, error: null });
    queueError("extractions", "count boom");
    await expect(getActivationUsageCore(ctx(client))).rejects.toThrow("count boom");
  });
});

describe("checkActivationBudgetCore", () => {
  it("allows an import within the remaining budget", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("user_roles", { data: null, error: null });
    queueResponse("workspaces", { data: WS_FREE, error: null });
    queueResponse("extractions", { data: null, error: null, count: 400 } as never);

    await expect(checkActivationBudgetCore({ requested: 50 }, ctx(client)))
      .resolves.toEqual({ ok: true, used: 400, limit: 500, remaining: 50 });
  });

  it("blocks an import that would exceed the remaining budget", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("user_roles", { data: null, error: null });
    queueResponse("workspaces", { data: WS_FREE, error: null });
    queueResponse("extractions", { data: null, error: null, count: 490 } as never);
    queueResponse("notifications", { data: [], error: null }); // dedupe check
    queueResponse("workspace_members", { data: [], error: null }); // admins lookup

    await expect(checkActivationBudgetCore({ requested: 50 }, ctx(client)))
      .rejects.toThrow(/only 10 remain/);
  });

  it("never blocks a super admin inside their own workspace", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("user_roles", { data: { role: "super_admin" }, error: null });
    queueResponse("workspace_members", { data: { workspace_id: "ws1" }, error: null });
    queueResponse("workspaces", { data: WS_FREE, error: null });
    queueResponse("extractions", { data: null, error: null, count: 999999 } as never);

    await expect(checkActivationBudgetCore({ requested: 100000 }, ctx(client)))
      .resolves.toMatchObject({ ok: true, limit: null });
  });
});
