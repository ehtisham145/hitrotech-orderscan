import { describe, it, expect } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";
import { getBusinessTrendsCore } from "./trends.functions";

const ctx = (client: unknown) => ({ supabase: client as never, userId: "u1" });

const queueDataQueries = (queueResponse: ReturnType<typeof createMockSupabase>["queueResponse"]) => {
  queueResponse("extractions", { data: [], error: null });
  queueResponse("extractions", { data: [], error: null });
  queueResponse("partners", { data: [], error: null });
};

describe("getBusinessTrendsCore — workspace resolution", () => {
  it("uses the caller's active workspace when none is explicitly given", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: "ws1" }, error: null });
    queueDataQueries(queueResponse);

    await getBusinessTrendsCore({}, ctx(client));
    expect(getChain("extractions").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("returns null when the caller has no active workspace and none was given", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: null }, error: null });
    await expect(getBusinessTrendsCore({}, ctx(client))).resolves.toBeNull();
  });

  it("allows a member to view an explicitly-requested workspace they belong to", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("workspace_members", { data: { workspace_id: "ws2" }, error: null });
    queueResponse("user_roles", { data: null, error: null });
    queueDataQueries(queueResponse);

    await getBusinessTrendsCore({ workspaceId: "ws2" }, ctx(client));
    expect(getChain("extractions").eq).toHaveBeenCalledWith("workspace_id", "ws2");
  });

  it("allows a super admin to view a workspace they aren't a member of", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspace_members", { data: null, error: null });
    queueResponse("user_roles", { data: { role: "super_admin" }, error: null });
    queueDataQueries(queueResponse);

    await expect(getBusinessTrendsCore({ workspaceId: "ws2" }, ctx(client))).resolves.not.toBeNull();
  });

  it("refuses a caller who is neither a member nor a super admin of the requested workspace", async () => {
    // Regression guard: this endpoint used to take a caller-supplied
    // workspaceId with *no* authorization check at all, leaking every
    // workspace's commission/partner/revenue trends to any signed-in user.
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspace_members", { data: null, error: null });
    queueResponse("user_roles", { data: null, error: null });

    await expect(getBusinessTrendsCore({ workspaceId: "someone-elses-ws" }, ctx(client)))
      .rejects.toThrow("Not a member of this workspace");
  });

  it("surfaces the membership-check error rather than reporting a plain refusal", async () => {
    const { client, queueError, queueResponse } = createMockSupabase();
    queueError("workspace_members", "boom");
    queueResponse("user_roles", { data: null, error: null });
    await expect(getBusinessTrendsCore({ workspaceId: "ws2" }, ctx(client))).rejects.toThrow("boom");
  });

  it("surfaces the active-workspace profile lookup error", async () => {
    const { client, queueError } = createMockSupabase();
    queueError("profiles", "boom");
    await expect(getBusinessTrendsCore({}, ctx(client))).rejects.toThrow("boom");
  });
});

describe("getBusinessTrendsCore — data", () => {
  it("surfaces the main extractions query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: "ws1" }, error: null });
    queueError("extractions", "boom");
    queueResponse("extractions", { data: [], error: null });
    queueResponse("partners", { data: [], error: null });
    await expect(getBusinessTrendsCore({}, ctx(client))).rejects.toThrow("boom");
  });

  it("surfaces the quality extractions query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: "ws1" }, error: null });
    queueResponse("extractions", { data: [], error: null });
    queueError("extractions", "quality boom");
    queueResponse("partners", { data: [], error: null });
    await expect(getBusinessTrendsCore({}, ctx(client))).rejects.toThrow("quality boom");
  });

  it("surfaces the partners query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: "ws1" }, error: null });
    queueResponse("extractions", { data: [], error: null });
    queueResponse("extractions", { data: [], error: null });
    queueError("partners", "partners boom");
    await expect(getBusinessTrendsCore({}, ctx(client))).rejects.toThrow("partners boom");
  });

  it("computes quality counts from the quality query", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: "ws1" }, error: null });
    queueResponse("extractions", { data: [], error: null });
    queueResponse("extractions", {
      data: [
        { status: "success", is_duplicate: false },
        { status: "failed", is_duplicate: false },
        { status: "success", is_duplicate: true },
        { status: "pending", is_duplicate: false },
      ],
      error: null,
    });
    queueResponse("partners", { data: [], error: null });

    const result = await getBusinessTrendsCore({}, ctx(client));
    expect(result?.quality).toEqual({ total: 4, success: 1, failed: 1, duplicate: 1, pending: 1 });
  });
});
