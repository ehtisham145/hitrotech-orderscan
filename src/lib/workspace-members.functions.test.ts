import { describe, it, expect, vi } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";
import {
  updateMemberRoleCore,
  removeMemberCore,
  transferOwnershipCore,
  listAllWorkspacesCore,
  getWorkspaceBillingCore,
  updateWorkspacePlanCore,
} from "./workspace-members.functions";

const adminFrom = vi.fn();
vi.mock("@/integrations/supabase/ext-client.server", () => ({
  supabaseAdmin: { from: (...a: unknown[]) => adminFrom(...a) },
}));

const PROFILE = { data: { active_workspace_id: "ws1" }, error: null };
const NOT_SUPER = { data: null, error: null };
const IS_SUPER = { data: { role: "super_admin" }, error: null };
const ctx = (client: unknown, userId = "u1") => ({ supabase: client as never, userId });

/** profiles (active workspace) then user_roles (super-admin check). */
function queueAuth(
  q: ReturnType<typeof createMockSupabase>["queueResponse"],
  opts: { isSuper?: boolean; memberRole?: string | null } = {},
) {
  q("profiles", PROFILE);
  q("user_roles", opts.isSuper ? IS_SUPER : NOT_SUPER);
  if (!opts.isSuper) {
    q("workspace_members", { data: opts.memberRole ? { role: opts.memberRole } : null, error: null });
  }
}

describe("assertWorkspaceRole, through updateMemberRoleCore", () => {
  it("refuses someone who is not a member at all", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueAuth(queueResponse, { memberRole: null });
    await expect(updateMemberRoleCore({ memberId: "m1", role: "manager" }, ctx(client)))
      .rejects.toThrow("Forbidden");
  });

  it("refuses a member whose role is below owner/admin", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueAuth(queueResponse, { memberRole: "employee" });
    await expect(updateMemberRoleCore({ memberId: "m1", role: "manager" }, ctx(client)))
      .rejects.toThrow("Forbidden");
  });

  it("admits a super admin without them being a member", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueAuth(queueResponse, { isSuper: true });
    queueResponse("workspace_members", { data: { user_id: "u2", workspace_id: "ws1", role: "employee" }, error: null });
    queueResponse("workspaces", { data: { owner_id: "owner" }, error: null });
    queueResponse("workspace_members", { data: null, error: null });
    queueResponse("audit_logs", { data: null, error: null });

    await expect(updateMemberRoleCore({ memberId: "m1", role: "manager" }, ctx(client)))
      .resolves.toEqual({ ok: true });
  });
});

describe("updateMemberRoleCore", () => {
  function queueOk(q: ReturnType<typeof createMockSupabase>["queueResponse"], member: unknown, ownerId: string) {
    queueAuth(q, { memberRole: "admin" });
    q("workspace_members", { data: member, error: null });
    q("workspaces", { data: { owner_id: ownerId }, error: null });
    q("workspace_members", { data: null, error: null });
    q("audit_logs", { data: null, error: null });
  }

  it("refuses a member id from another workspace", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueAuth(queueResponse, { memberRole: "admin" });
    queueResponse("workspace_members", { data: { user_id: "u2", workspace_id: "ws-other", role: "employee" }, error: null });

    await expect(updateMemberRoleCore({ memberId: "m1", role: "manager" }, ctx(client)))
      .rejects.toThrow("Wrong workspace");
  });

  it("refuses a member id that does not exist", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueAuth(queueResponse, { memberRole: "admin" });
    queueResponse("workspace_members", { data: null, error: null });
    await expect(updateMemberRoleCore({ memberId: "m1", role: "manager" }, ctx(client)))
      .rejects.toThrow("Member not found");
  });

  it("will not let an admin change the owner's role", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueAuth(queueResponse, { memberRole: "admin" });
    queueResponse("workspace_members", { data: { user_id: "theOwner", workspace_id: "ws1", role: "owner" }, error: null });
    queueResponse("workspaces", { data: { owner_id: "theOwner" }, error: null });

    await expect(updateMemberRoleCore({ memberId: "m1", role: "manager" }, ctx(client)))
      .rejects.toThrow(/Cannot change the owner's role/);
  });

  it("records the change in the audit log with both old and new role", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueOk(queueResponse, { user_id: "u2", workspace_id: "ws1", role: "employee" }, "theOwner");

    await updateMemberRoleCore({ memberId: "m1", role: "manager" }, ctx(client));

    const entry = getChain("audit_logs").insert.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      user_id: "u1", workspace_id: "ws1", action: "workspace.member_role_updated", entity_id: "m1",
    });
    expect(entry.details).toEqual({ target_user_id: "u2", from: "employee", to: "manager" });
  });
});

describe("removeMemberCore", () => {
  it("refuses a member id from another workspace", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueAuth(queueResponse, { memberRole: "admin" });
    queueResponse("workspace_members", { data: { user_id: "u2", workspace_id: "ws-other", role: "employee" }, error: null });
    await expect(removeMemberCore({ memberId: "m1" }, ctx(client))).rejects.toThrow("Wrong workspace");
  });

  it("will not let an admin remove the owner", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueAuth(queueResponse, { memberRole: "admin" });
    queueResponse("workspace_members", { data: { user_id: "theOwner", workspace_id: "ws1", role: "owner" }, error: null });
    queueResponse("workspaces", { data: { owner_id: "theOwner" }, error: null });
    await expect(removeMemberCore({ memberId: "m1" }, ctx(client))).rejects.toThrow(/Cannot remove the owner/);
  });

  it("removes an ordinary member and audits it", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueAuth(queueResponse, { memberRole: "owner" });
    queueResponse("workspace_members", { data: { user_id: "u2", workspace_id: "ws1", role: "employee" }, error: null });
    queueResponse("workspaces", { data: { owner_id: "u1" }, error: null });
    queueResponse("workspace_members", { data: null, error: null });
    queueResponse("audit_logs", { data: null, error: null });

    await expect(removeMemberCore({ memberId: "m1" }, ctx(client))).resolves.toEqual({ ok: true });
    expect(getChain("audit_logs").insert.mock.calls[0][0]).toMatchObject({
      action: "workspace.member_removed",
    });
  });
});

describe("transferOwnershipCore", () => {
  it("refuses anyone who is neither the owner nor a super admin", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("workspaces", { data: { owner_id: "someoneElse" }, error: null });
    queueResponse("user_roles", NOT_SUPER);

    await expect(transferOwnershipCore({ newOwnerUserId: "u2" }, ctx(client)))
      .rejects.toThrow(/Only the current owner can transfer ownership/);
  });

  it("refuses a target who is not a member of the workspace", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("workspaces", { data: { owner_id: "u1" }, error: null });
    queueResponse("user_roles", NOT_SUPER);
    queueResponse("workspace_members", { data: null, error: null });

    await expect(transferOwnershipCore({ newOwnerUserId: "u2" }, ctx(client)))
      .rejects.toThrow(/not a member of this workspace/);
  });

  it("refuses transferring to whoever already owns it", async () => {
    // Regression: this was not a no-op. The writes set the new owner's role to
    // "owner" and then the previous owner's to "admin"; when they are the same
    // person the second overwrites the first, leaving owner_id pointing at a
    // member whose role says "admin".
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("workspaces", { data: { owner_id: "u1" }, error: null });
    queueResponse("user_roles", NOT_SUPER);
    queueResponse("workspace_members", { data: { id: "m1" }, error: null });

    await expect(transferOwnershipCore({ newOwnerUserId: "u1" }, ctx(client)))
      .rejects.toThrow("That user already owns this workspace.");
  });

  it("moves owner_id, promotes the new owner and demotes the old one", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("workspaces", { data: { owner_id: "u1" }, error: null });
    queueResponse("user_roles", NOT_SUPER);
    queueResponse("workspace_members", { data: { id: "m2" }, error: null });
    queueResponse("workspaces", { data: null, error: null });        // owner_id
    queueResponse("workspace_members", { data: null, error: null }); // promote
    queueResponse("workspace_members", { data: null, error: null }); // demote
    queueResponse("audit_logs", { data: null, error: null });

    await expect(transferOwnershipCore({ newOwnerUserId: "u2" }, ctx(client))).resolves.toEqual({ ok: true });

    expect(getChain("workspaces", 1).update).toHaveBeenCalledWith({ owner_id: "u2" });
    expect(getChain("workspace_members", 1).update).toHaveBeenCalledWith({ role: "owner" });
    expect(getChain("workspace_members", 2).update).toHaveBeenCalledWith({ role: "admin" });
    expect(getChain("audit_logs").insert.mock.calls[0][0]).toMatchObject({
      action: "workspace.ownership_transferred",
      details: { from_user_id: "u1", to_user_id: "u2" },
    });
  });
});

describe("listAllWorkspacesCore / getWorkspaceBillingCore", () => {
  it("listing every workspace is super-admin only", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("user_roles", NOT_SUPER);
    await expect(listAllWorkspacesCore(ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("billing is visible to any member of the workspace", async () => {
    const { client, queueResponse, queueRpc } = createMockSupabase();
    queueAuth(queueResponse, { memberRole: "partner" });
    queueResponse("workspaces", { data: { plan_tier: "pro" }, error: null });
    queueRpc("workspace_seat_usage", { data: 3, error: null });
    await expect(getWorkspaceBillingCore(ctx(client))).resolves.toBeTruthy();
  });

  it("billing is refused to a non-member", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueAuth(queueResponse, { memberRole: null });
    await expect(getWorkspaceBillingCore(ctx(client))).rejects.toThrow(/Forbidden/);
  });
});

describe("updateWorkspacePlanCore", () => {
  const input = { workspaceId: "ws1", planTier: "pro" as const, seatLimit: 25 };

  it("is super-admin only", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("user_roles", NOT_SUPER);
    await expect(updateWorkspacePlanCore(input, ctx(client))).rejects.toThrow("Forbidden");
  });

  it("clears a stale expiry so the granted plan is actually active", async () => {
    // Regression: the grant set only plan_tier and seat_limit, leaving whatever
    // plan_expires_at was already there. A past date meant every feature check
    // read the new plan as already expired.
    const update = vi.fn(() => ({ eq: () => ({ error: null }) }));
    adminFrom.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => ({ data: { plan_tier: "free", seat_limit: 2 } }) }) }),
      update,
    });

    const { client, queueResponse } = createMockSupabase();
    queueResponse("user_roles", IS_SUPER);
    queueResponse("audit_logs", { data: null, error: null });

    await expect(updateWorkspacePlanCore(input, ctx(client))).resolves.toEqual({ ok: true });

    const written = update.mock.calls[0][0] as Record<string, unknown>;
    expect(written).toMatchObject({ plan_tier: "pro", seat_limit: 25, plan_expires_at: null });
    expect(written.plan_activated_at).toEqual(expect.any(String));
  });

  it("audits the change with the previous values", async () => {
    adminFrom.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => ({ data: { plan_tier: "starter", seat_limit: 5 } }) }) }),
      update: () => ({ eq: () => ({ error: null }) }),
    });

    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("user_roles", IS_SUPER);
    queueResponse("audit_logs", { data: null, error: null });

    await updateWorkspacePlanCore(input, ctx(client));

    const entry = getChain("audit_logs").insert.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toMatchObject({ action: "workspace.plan_updated", entity_id: "ws1" });
    expect(entry.details).toEqual({
      from: { plan_tier: "starter", seat_limit: 5 },
      to: { plan_tier: "pro", seat_limit: 25 },
    });
  });
});
