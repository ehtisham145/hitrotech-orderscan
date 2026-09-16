import { describe, it, expect } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";
import { getRecentActivityCore } from "./activity.functions";

const ctx = (client: unknown) => ({ supabase: client as never, userId: "u1" });

describe("getRecentActivityCore", () => {
  it("summarises the workspace's audit log with human-readable labels and actor names", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: "ws1" }, error: null });
    queueResponse("audit_logs", {
      data: [{ id: "a1", user_id: "u2", action: "workspace.rename", entity_type: "workspace", entity_id: "ws1", details: {}, created_at: "t" }],
      error: null,
    });
    queueResponse("profiles", { data: [{ id: "u2", full_name: "Jane", email: "j@x.com" }], error: null });

    const result = await getRecentActivityCore({}, ctx(client));

    expect(result).toEqual([{
      id: "a1", action: "workspace.rename", label: "renamed the workspace",
      actor_name: "Jane", entity_type: "workspace", entity_id: "ws1", details: {}, created_at: "t",
    }]);
    expect(getChain("audit_logs").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("falls back to a humanised action string for an unmapped action", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: "ws1" }, error: null });
    queueResponse("audit_logs", {
      data: [{ id: "a1", user_id: null, action: "some.unmapped_action", entity_type: null, entity_id: null, details: null, created_at: "t" }],
      error: null,
    });

    const result = await getRecentActivityCore({}, ctx(client));
    expect(result[0].label).toBe("some unmapped action");
    expect(result[0].actor_name).toBeNull();
  });

  it("returns an empty feed when the caller has no active workspace", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: null }, error: null });
    await expect(getRecentActivityCore({}, ctx(client))).resolves.toEqual([]);
  });

  it("fails instead of reporting no activity when the profile lookup errors", async () => {
    const { client, queueError } = createMockSupabase();
    queueError("profiles", "boom");
    await expect(getRecentActivityCore({}, ctx(client))).rejects.toThrow("boom");
  });

  it("fails instead of reporting an empty feed when the audit_logs query errors", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: "ws1" }, error: null });
    queueError("audit_logs", "boom");
    await expect(getRecentActivityCore({}, ctx(client))).rejects.toThrow("boom");
  });

  it("fails instead of leaving actor names blank when the profiles lookup errors", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: "ws1" }, error: null });
    queueResponse("audit_logs", { data: [{ id: "a1", user_id: "u2", action: "x", entity_type: null, entity_id: null, details: null, created_at: "t" }], error: null });
    queueError("profiles", "boom");
    await expect(getRecentActivityCore({}, ctx(client))).rejects.toThrow("boom");
  });

  it("clamps limit to the 1..50 range", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: "ws1" }, error: null });
    queueResponse("audit_logs", { data: [], error: null });
    await getRecentActivityCore({ limit: 999 }, ctx(client));
    expect(getChain("audit_logs").limit).toHaveBeenCalledWith(50);
  });
});
