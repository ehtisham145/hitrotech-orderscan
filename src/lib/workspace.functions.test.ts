import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";

// getActiveWorkspaceCore's auto-provisioning path dynamically imports the
// privileged admin client — mocked so it never touches a real project, same
// pattern as batch-actions.functions.test.ts.
let adminMock = createMockSupabase();
vi.mock("@/integrations/supabase/ext-client.server", () => ({
  get supabaseAdmin() {
    return adminMock.client;
  },
}));

import {
  getActiveWorkspaceCore,
  setActiveWorkspaceCore,
  createWorkspaceCore,
  renameWorkspaceCore,
  deleteWorkspaceCore,
  leaveWorkspaceCore,
} from "./workspace.functions";

const ctx = (client: unknown, extra: Record<string, unknown> = {}) => ({ supabase: client as never, userId: "u1", ...extra });

const WS1 = { id: "ws1", name: "Alpha", slug: "alpha", owner_id: "u1", plan_tier: "starter", plan_expires_at: null, seat_limit: 5 };
const WS2 = { id: "ws2", name: "Beta", slug: "beta", owner_id: "u2", plan_tier: "free", plan_expires_at: null, seat_limit: 2 };

beforeEach(() => {
  adminMock = createMockSupabase();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getActiveWorkspaceCore", () => {
  it("returns the preferred workspace when it's a valid membership", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: "ws1" }, error: null });
    queueResponse("workspace_members", {
      data: [
        { workspace_id: "ws1", role: "owner", workspaces: WS1 },
        { workspace_id: "ws2", role: "member", workspaces: WS2 },
      ],
      error: null,
    });
    queueResponse("user_roles", { data: null, error: null });

    const result = await getActiveWorkspaceCore(ctx(client));

    expect(result.workspace?.id).toBe("ws1");
    expect(result.workspaces).toHaveLength(2);
    expect(result.isSuperAdmin).toBe(false);
    expect(result.isImpersonating).toBe(false);
  });

  it("falls back to the oldest membership when the preferred workspace isn't one of them", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: "not-a-member-of-this" }, error: null });
    queueResponse("workspace_members", { data: [{ workspace_id: "ws1", role: "owner", workspaces: WS1 }], error: null });
    queueResponse("user_roles", { data: null, error: null });
    queueResponse("profiles", { data: null, error: null }); // the self-healing correction write

    const result = await getActiveWorkspaceCore(ctx(client));
    expect(result.workspace?.id).toBe("ws1");
  });

  it("surfaces a profile query error", async () => {
    const { client, queueError, queueResponse } = createMockSupabase();
    queueError("profiles", "profile boom");
    queueResponse("workspace_members", { data: [], error: null });
    queueResponse("user_roles", { data: null, error: null });
    await expect(getActiveWorkspaceCore(ctx(client))).rejects.toThrow("profile boom");
  });

  it("surfaces a membership query error instead of treating the caller as having none", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: null }, error: null });
    queueError("workspace_members", "member boom");
    queueResponse("user_roles", { data: null, error: null });
    await expect(getActiveWorkspaceCore(ctx(client))).rejects.toThrow("member boom");
  });

  it("surfaces a super_admin lookup error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: null }, error: null });
    queueResponse("workspace_members", { data: [], error: null });
    queueError("user_roles", "role boom");
    await expect(getActiveWorkspaceCore(ctx(client))).rejects.toThrow("role boom");
  });

  it("auto-provisions a workspace for a caller with zero memberships", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: null }, error: null });
    queueResponse("workspace_members", { data: [], error: null });
    queueResponse("user_roles", { data: null, error: null });

    adminMock.queueResponse("profiles", { data: null, error: null }); // upsert
    adminMock.queueResponse("workspaces", { data: null, error: null }); // no owned workspace yet
    adminMock.queueResponse("workspaces", { data: { ...WS1, id: "new-ws" }, error: null }); // insert
    adminMock.queueResponse("workspace_members", { data: null, error: null }); // insert membership
    adminMock.queueResponse("profiles", { data: null, error: null }); // set active_workspace_id

    const result = await getActiveWorkspaceCore(ctx(client, { claims: { email: "a@b.com" } }));

    expect(result.workspace?.id).toBe("new-ws");
    expect(result.workspaces).toHaveLength(1);
  });

  it("fails instead of continuing when the auto-provision profile upsert errors", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: null }, error: null });
    queueResponse("workspace_members", { data: [], error: null });
    queueResponse("user_roles", { data: null, error: null });
    adminMock.queueError("profiles", "upsert boom");

    await expect(getActiveWorkspaceCore(ctx(client, { claims: {} }))).rejects.toThrow("upsert boom");
  });

  it("lets a super admin view a preferred workspace they aren't a member of", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: "ws2" }, error: null });
    queueResponse("workspace_members", { data: [{ workspace_id: "ws1", role: "owner", workspaces: WS1 }], error: null });
    queueResponse("user_roles", { data: { role: "super_admin" }, error: null });
    adminMock.queueResponse("workspaces", { data: WS2, error: null });

    const result = await getActiveWorkspaceCore(ctx(client));

    expect(result.workspace?.id).toBe("ws2");
    expect(result.isSuperAdmin).toBe(true);
    expect(result.isImpersonating).toBe(true);
    expect(result.workspaces.map((w) => w.id)).toEqual(["ws1", "ws2"]);
  });

  it("falls back gracefully (logging, not throwing) when the impersonation lookup errors", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: "ws2" }, error: null });
    queueResponse("workspace_members", { data: [{ workspace_id: "ws1", role: "owner", workspaces: WS1 }], error: null });
    queueResponse("user_roles", { data: { role: "super_admin" }, error: null });
    adminMock.queueError("workspaces", "impersonate boom");
    queueResponse("profiles", { data: null, error: null }); // the self-healing correction write

    const result = await getActiveWorkspaceCore(ctx(client));
    expect(result.workspace?.id).toBe("ws1"); // fell back to the real membership
    expect(console.error).toHaveBeenCalled();
  });
});

describe("setActiveWorkspaceCore", () => {
  it("switches the active workspace for a member", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("workspace_members", { data: { workspace_id: "ws1" }, error: null });
    queueResponse("user_roles", { data: null, error: null });
    queueResponse("profiles", { data: null, error: null });

    await expect(setActiveWorkspaceCore({ workspaceId: "ws1" }, ctx(client))).resolves.toEqual({ ok: true });
    expect(getChain("profiles").update).toHaveBeenCalledWith({ active_workspace_id: "ws1" });
  });

  it("allows a super admin who isn't a member", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspace_members", { data: null, error: null });
    queueResponse("user_roles", { data: { role: "super_admin" }, error: null });
    queueResponse("profiles", { data: null, error: null });

    await expect(setActiveWorkspaceCore({ workspaceId: "ws2" }, ctx(client))).resolves.toEqual({ ok: true });
  });

  it("refuses a caller who is neither a member nor a super admin", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspace_members", { data: null, error: null });
    queueResponse("user_roles", { data: null, error: null });
    await expect(setActiveWorkspaceCore({ workspaceId: "ws2" }, ctx(client))).rejects.toThrow("Not a member of this workspace");
  });

  it("surfaces a membership-check error", async () => {
    const { client, queueError, queueResponse } = createMockSupabase();
    queueError("workspace_members", "boom");
    queueResponse("user_roles", { data: null, error: null });
    await expect(setActiveWorkspaceCore({ workspaceId: "ws1" }, ctx(client))).rejects.toThrow("boom");
  });

  it("surfaces the final update error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("workspace_members", { data: { workspace_id: "ws1" }, error: null });
    queueResponse("user_roles", { data: null, error: null });
    queueError("profiles", "update boom");
    await expect(setActiveWorkspaceCore({ workspaceId: "ws1" }, ctx(client))).rejects.toThrow("update boom");
  });
});

describe("createWorkspaceCore", () => {
  it("creates the workspace, adds the caller as owner, activates it, and audits it", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("workspaces", { data: { id: "new-ws" }, error: null });
    queueResponse("workspace_members", { data: null, error: null });
    queueResponse("profiles", { data: null, error: null });
    queueResponse("audit_logs", { data: null, error: null });

    const result = await createWorkspaceCore({ name: "  My Shop  " }, ctx(client));

    expect(result).toEqual({ id: "new-ws" });
    expect(getChain("workspaces").insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "My Shop", owner_id: "u1" }),
    );
    expect(getChain("workspace_members").insert).toHaveBeenCalledWith({ workspace_id: "new-ws", user_id: "u1", role: "owner" });
  });

  it("rejects an empty name before touching the database", async () => {
    const { client } = createMockSupabase();
    await expect(createWorkspaceCore({ name: "   " }, ctx(client))).rejects.toThrow("Workspace name required");
  });

  it("surfaces a workspace-insert error", async () => {
    const { client, queueError } = createMockSupabase();
    queueError("workspaces", "boom");
    await expect(createWorkspaceCore({ name: "X" }, ctx(client))).rejects.toThrow("boom");
  });

  it("surfaces a membership-insert error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("workspaces", { data: { id: "new-ws" }, error: null });
    queueError("workspace_members", "boom");
    await expect(createWorkspaceCore({ name: "X" }, ctx(client))).rejects.toThrow("boom");
  });

  it("still returns success when the workspace was created but activating it failed", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("workspaces", { data: { id: "new-ws" }, error: null });
    queueResponse("workspace_members", { data: null, error: null });
    queueError("profiles", "activate boom");
    queueResponse("audit_logs", { data: null, error: null });

    await expect(createWorkspaceCore({ name: "X" }, ctx(client))).resolves.toEqual({ id: "new-ws" });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("renameWorkspaceCore", () => {
  it("renames the workspace for a caller with owner/admin role", async () => {
    const { client, allowRole, queueResponse, getChain } = createMockSupabase();
    allowRole();
    queueResponse("workspaces", { data: { name: "Old Name" }, error: null });
    queueResponse("workspaces", { data: null, error: null });
    queueResponse("audit_logs", { data: null, error: null });

    await expect(renameWorkspaceCore({ workspaceId: "ws1", name: "  New Name  " }, ctx(client))).resolves.toEqual({ ok: true });

    expect(getChain("workspaces", 1).update).toHaveBeenCalledWith({ name: "New Name" });
    expect(getChain("audit_logs").insert).toHaveBeenCalledWith(
      expect.objectContaining({ details: { from: "Old Name", to: "New Name" } }),
    );
  });

  it("refuses a caller without the owner/admin role", async () => {
    const { client, allowRole } = createMockSupabase();
    allowRole(false);
    await expect(renameWorkspaceCore({ workspaceId: "ws1", name: "X" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("rejects an empty name", async () => {
    const { client, allowRole } = createMockSupabase();
    allowRole();
    await expect(renameWorkspaceCore({ workspaceId: "ws1", name: "   " }, ctx(client))).rejects.toThrow("Workspace name required");
  });

  it("surfaces the previous-name lookup error", async () => {
    const { client, allowRole, queueError } = createMockSupabase();
    allowRole();
    queueError("workspaces", "lookup boom");
    await expect(renameWorkspaceCore({ workspaceId: "ws1", name: "X" }, ctx(client))).rejects.toThrow("lookup boom");
  });

  it("surfaces the update error", async () => {
    const { client, allowRole, queueResponse, queueError } = createMockSupabase();
    allowRole();
    queueResponse("workspaces", { data: { name: "Old" }, error: null });
    queueError("workspaces", "update boom");
    await expect(renameWorkspaceCore({ workspaceId: "ws1", name: "X" }, ctx(client))).rejects.toThrow("update boom");
  });

  it("still returns success when the rename worked but the audit write failed", async () => {
    const { client, allowRole, queueResponse, queueError } = createMockSupabase();
    allowRole();
    queueResponse("workspaces", { data: { name: "Old" }, error: null });
    queueResponse("workspaces", { data: null, error: null });
    queueError("audit_logs", "audit boom");

    await expect(renameWorkspaceCore({ workspaceId: "ws1", name: "X" }, ctx(client))).resolves.toEqual({ ok: true });
  });
});

describe("deleteWorkspaceCore", () => {
  it("deletes the workspace, moving the caller to another workspace first", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("workspaces", { data: { id: "ws1", name: "Alpha", owner_id: "u1" }, error: null });
    queueResponse("audit_logs", { data: null, error: null });
    queueResponse("workspace_members", { data: { workspace_id: "ws2" }, error: null });
    queueResponse("profiles", { data: null, error: null }); // reassign
    queueResponse("workspaces", { data: null, error: null }); // delete

    const result = await deleteWorkspaceCore({ workspaceId: "ws1", confirmName: "Alpha" }, ctx(client));

    expect(result).toEqual({ ok: true, nextWorkspaceId: "ws2" });
    // The reassignment must happen before the workspace delete — assert by
    // call order: profiles update is call #1 overall on "profiles",
    // and the delete is the *second* call on "workspaces".
    expect(getChain("profiles").update).toHaveBeenCalledWith({ active_workspace_id: "ws2" });
    expect(getChain("workspaces", 1).delete).toHaveBeenCalled();
  });

  it("excludes the workspace being deleted when picking a fallback workspace", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("workspaces", { data: { id: "ws1", name: "Alpha", owner_id: "u1" }, error: null });
    queueResponse("audit_logs", { data: null, error: null });
    queueResponse("workspace_members", { data: null, error: null });
    queueResponse("profiles", { data: null, error: null });
    queueResponse("workspaces", { data: null, error: null });

    await deleteWorkspaceCore({ workspaceId: "ws1", confirmName: "Alpha" }, ctx(client));

    expect(getChain("workspace_members").neq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("nulls the active workspace when there is no other membership", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspaces", { data: { id: "ws1", name: "Alpha", owner_id: "u1" }, error: null });
    queueResponse("audit_logs", { data: null, error: null });
    queueResponse("workspace_members", { data: null, error: null });
    queueResponse("profiles", { data: null, error: null });
    queueResponse("workspaces", { data: null, error: null });

    const result = await deleteWorkspaceCore({ workspaceId: "ws1", confirmName: "Alpha" }, ctx(client));
    expect(result.nextWorkspaceId).toBeNull();
  });

  it("refuses a non-owner", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspaces", { data: { id: "ws1", name: "Alpha", owner_id: "someone-else" }, error: null });
    await expect(deleteWorkspaceCore({ workspaceId: "ws1", confirmName: "Alpha" }, ctx(client)))
      .rejects.toThrow("Only the owner can delete this workspace");
  });

  it("refuses when the confirmation name doesn't match", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspaces", { data: { id: "ws1", name: "Alpha", owner_id: "u1" }, error: null });
    await expect(deleteWorkspaceCore({ workspaceId: "ws1", confirmName: "Wrong" }, ctx(client)))
      .rejects.toThrow("Name confirmation does not match");
  });

  it("refuses a workspace that doesn't exist", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspaces", { data: null, error: null });
    await expect(deleteWorkspaceCore({ workspaceId: "gone", confirmName: "Alpha" }, ctx(client)))
      .rejects.toThrow("Workspace not found");
  });

  it("aborts the delete when the audit-log write fails, instead of deleting without a trail", async () => {
    const { client, queueResponse, queueError, getChain } = createMockSupabase();
    queueResponse("workspaces", { data: { id: "ws1", name: "Alpha", owner_id: "u1" }, error: null });
    queueError("audit_logs", "audit boom");

    await expect(deleteWorkspaceCore({ workspaceId: "ws1", confirmName: "Alpha" }, ctx(client))).rejects.toThrow("audit boom");
    // Nothing after the audit log should have run.
    expect(() => getChain("workspace_members")).toThrow();
  });

  it("aborts before deleting if reassigning the caller's active workspace fails", async () => {
    const { client, queueResponse, queueError, getChain } = createMockSupabase();
    queueResponse("workspaces", { data: { id: "ws1", name: "Alpha", owner_id: "u1" }, error: null });
    queueResponse("audit_logs", { data: null, error: null });
    queueResponse("workspace_members", { data: null, error: null });
    queueError("profiles", "reassign boom");

    await expect(deleteWorkspaceCore({ workspaceId: "ws1", confirmName: "Alpha" }, ctx(client))).rejects.toThrow("reassign boom");
    // The workspace delete itself (second call to "workspaces") must never have run.
    expect(() => getChain("workspaces", 1)).toThrow();
  });
});

describe("leaveWorkspaceCore", () => {
  it("leaves the workspace and reassigns the active workspace when it was the one left", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("workspaces", { data: { id: "ws1", name: "Alpha", owner_id: "someone-else" }, error: null });
    queueResponse("workspace_members", { data: { id: "m1", role: "member" }, error: null });
    queueResponse("workspace_members", { data: null, error: null }); // delete
    queueResponse("audit_logs", { data: null, error: null });
    queueResponse("profiles", { data: { active_workspace_id: "ws1" }, error: null });
    queueResponse("workspace_members", { data: { workspace_id: "ws2" }, error: null });
    queueResponse("profiles", { data: null, error: null }); // reassign

    const result = await leaveWorkspaceCore({ workspaceId: "ws1" }, ctx(client));
    expect(result).toEqual({ ok: true, nextWorkspaceId: "ws2" });
    expect(getChain("profiles", 1).update).toHaveBeenCalledWith({ active_workspace_id: "ws2" });
  });

  it("does not touch the active workspace when a different one was left", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("workspaces", { data: { id: "ws1", name: "Alpha", owner_id: "someone-else" }, error: null });
    queueResponse("workspace_members", { data: { id: "m1", role: "member" }, error: null });
    queueResponse("workspace_members", { data: null, error: null });
    queueResponse("audit_logs", { data: null, error: null });
    queueResponse("profiles", { data: { active_workspace_id: "ws-other" }, error: null });

    const result = await leaveWorkspaceCore({ workspaceId: "ws1" }, ctx(client));
    expect(result).toEqual({ ok: true, nextWorkspaceId: "ws-other" });
    expect(() => getChain("profiles", 1)).toThrow();
  });

  it("refuses the owner leaving their own workspace", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspaces", { data: { id: "ws1", name: "Alpha", owner_id: "u1" }, error: null });
    await expect(leaveWorkspaceCore({ workspaceId: "ws1" }, ctx(client)))
      .rejects.toThrow("Owners cannot leave their own workspace");
  });

  it("refuses a caller who isn't a member", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspaces", { data: { id: "ws1", name: "Alpha", owner_id: "someone-else" }, error: null });
    queueResponse("workspace_members", { data: null, error: null });
    await expect(leaveWorkspaceCore({ workspaceId: "ws1" }, ctx(client)))
      .rejects.toThrow("You are not a member of this workspace");
  });

  it("refuses a workspace that doesn't exist", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspaces", { data: null, error: null });
    await expect(leaveWorkspaceCore({ workspaceId: "gone" }, ctx(client))).rejects.toThrow("Workspace not found");
  });

  it("surfaces a delete error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("workspaces", { data: { id: "ws1", name: "Alpha", owner_id: "someone-else" }, error: null });
    queueResponse("workspace_members", { data: { id: "m1", role: "member" }, error: null });
    queueError("workspace_members", "delete boom");
    await expect(leaveWorkspaceCore({ workspaceId: "ws1" }, ctx(client))).rejects.toThrow("delete boom");
  });

  it("still succeeds when leaving worked but the audit write failed", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("workspaces", { data: { id: "ws1", name: "Alpha", owner_id: "someone-else" }, error: null });
    queueResponse("workspace_members", { data: { id: "m1", role: "member" }, error: null });
    queueResponse("workspace_members", { data: null, error: null });
    queueError("audit_logs", "audit boom");
    queueResponse("profiles", { data: { active_workspace_id: "ws-other" }, error: null });

    await expect(leaveWorkspaceCore({ workspaceId: "ws1" }, ctx(client))).resolves.toMatchObject({ ok: true });
  });
});
