import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";
import {
  assertCanRecoverMember,
  getMemberSecurityStatusCore,
  resetMemberTwoFactorCore,
  sendMemberPasswordResetCore,
} from "./admin-recovery.functions";

const profilesUpdate = vi.fn();
const auditInsert = vi.fn();
const recoveryDelete = vi.fn();
const updateUserById = vi.fn();
const getUserById = vi.fn();
const generateLink = vi.fn();
const listFactors = vi.fn();
const deleteFactor = vi.fn();

vi.mock("@/integrations/supabase/ext-client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: () => ({ data: null }), data: [], error: null }) }),
      update: (patch: unknown) => ({ eq: () => profilesUpdate(table, patch) }),
      insert: (row: unknown) => auditInsert(table, row),
      delete: () => ({ eq: () => recoveryDelete(table) }),
    }),
    auth: {
      admin: {
        updateUserById: (...a: unknown[]) => updateUserById(...a),
        getUserById: (...a: unknown[]) => getUserById(...a),
        generateLink: (...a: unknown[]) => generateLink(...a),
        mfa: {
          listFactors: (...a: unknown[]) => listFactors(...a),
          deleteFactor: (...a: unknown[]) => deleteFactor(...a),
        },
      },
    },
  },
}));

const PROFILE = { data: { active_workspace_id: "ws1" }, error: null };
const ctx = (client: unknown, userId = "caller") => ({ supabase: client as never, userId });

/** profiles → caller's membership → target's membership. */
function queueGuard(
  q: ReturnType<typeof createMockSupabase>["queueResponse"],
  callerRole: string | null,
  targetRole: string | null,
) {
  q("profiles", PROFILE);
  q("workspace_members", { data: callerRole ? { role: callerRole } : null, error: null });
  if (callerRole && ["owner", "admin"].includes(callerRole)) {
    q("workspace_members", { data: targetRole ? { role: targetRole } : null, error: null });
  }
}

beforeEach(() => {
  profilesUpdate.mockReset().mockReturnValue({ error: null });
  auditInsert.mockReset().mockReturnValue({ error: null });
  recoveryDelete.mockReset().mockReturnValue({ error: null });
  updateUserById.mockReset().mockResolvedValue({ data: { user: { email: "new@x.com" } }, error: null });
  getUserById.mockReset().mockResolvedValue({ data: { user: { email: "old@x.com" } } });
  generateLink.mockReset().mockResolvedValue({ data: { properties: { action_link: "https://link" } }, error: null });
  listFactors.mockReset().mockResolvedValue({ data: { factors: [] } });
  deleteFactor.mockReset();
  delete process.env.RESEND_API_KEY;
});

describe("assertCanRecoverMember", () => {
  it("refuses acting on yourself", async () => {
    const { client } = createMockSupabase();
    await expect(assertCanRecoverMember(client, "u1", "u1"))
      .rejects.toThrow(/Use your own settings page/);
  });

  it("refuses a caller who is not a member of the workspace", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueGuard(queueResponse, null, null);
    await expect(assertCanRecoverMember(client, "caller", "target"))
      .rejects.toThrow(/Only workspace owner or admin/);
  });

  it("refuses a caller below owner/admin", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueGuard(queueResponse, "manager", "employee");
    await expect(assertCanRecoverMember(client, "caller", "target"))
      .rejects.toThrow(/Only workspace owner or admin/);
  });

  it("refuses a target who is not a member of this workspace", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueGuard(queueResponse, "admin", null);
    await expect(assertCanRecoverMember(client, "caller", "target"))
      .rejects.toThrow("User is not a member of this workspace");
  });

  it("refuses resetting the workspace owner", async () => {
    // An admin must not be able to take over the owner's account this way.
    const { client, queueResponse } = createMockSupabase();
    queueGuard(queueResponse, "admin", "owner");
    await expect(assertCanRecoverMember(client, "caller", "target"))
      .rejects.toThrow("Cannot reset the workspace owner from here");
  });

  it("allows an owner to recover an ordinary member", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueGuard(queueResponse, "owner", "employee");
    await expect(assertCanRecoverMember(client, "caller", "target"))
      .resolves.toEqual({ workspaceId: "ws1", callerRole: "owner", targetRole: "employee" });
  });

  it("refuses when the caller has no active workspace", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", { data: { active_workspace_id: null }, error: null });
    await expect(assertCanRecoverMember(client, "caller", "target")).rejects.toThrow("No active workspace");
  });
});

describe("getMemberSecurityStatusCore", () => {
  it("is refused to a caller who is not owner/admin", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueGuard(queueResponse, "employee", "employee");
    await expect(getMemberSecurityStatusCore({ memberUserId: "target" }, ctx(client)))
      .rejects.toThrow(/Only workspace owner or admin/);
  });
});

describe("resetMemberTwoFactorCore", () => {
  it("is refused to a caller who is not owner/admin", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueGuard(queueResponse, "manager", "employee");
    await expect(resetMemberTwoFactorCore({ memberUserId: "target" }, ctx(client)))
      .rejects.toThrow(/Only workspace owner or admin/);
  });

  it("is refused when the target is the workspace owner", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueGuard(queueResponse, "admin", "owner");
    await expect(resetMemberTwoFactorCore({ memberUserId: "target" }, ctx(client)))
      .rejects.toThrow("Cannot reset the workspace owner from here");
  });

  it("clears every enrolled factor and the recovery codes, and audits it", async () => {
    listFactors.mockResolvedValue({ data: { factors: [{ id: "f1" }, { id: "f2" }] } });
    const { client, queueResponse } = createMockSupabase();
    queueGuard(queueResponse, "owner", "employee");

    await expect(resetMemberTwoFactorCore({ memberUserId: "target" }, ctx(client)))
      .resolves.toMatchObject({ ok: true });

    expect(profilesUpdate).toHaveBeenCalledWith("profiles", { email_2fa_enabled: false });
    expect(deleteFactor).toHaveBeenCalledTimes(2);
    expect(recoveryDelete).toHaveBeenCalledWith("user_recovery_codes");
    expect(auditInsert.mock.calls[0][1]).toMatchObject({ entity_id: "target", user_id: "caller" });
  });
});

describe("sendMemberPasswordResetCore", () => {
  const input = { memberUserId: "target", origin: "https://app.test" };

  it("is refused to a caller who is not owner/admin", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueGuard(queueResponse, "employee", "employee");
    await expect(sendMemberPasswordResetCore(input, ctx(client)))
      .rejects.toThrow(/Only workspace owner or admin/);
  });

  it("sends to the member's existing address when no new email is given", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueGuard(queueResponse, "owner", "employee");

    const res = await sendMemberPasswordResetCore(input, ctx(client));

    expect(updateUserById).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: true, email: "old@x.com" });
    expect(generateLink).toHaveBeenCalledWith(expect.objectContaining({ type: "recovery", email: "old@x.com" }));
  });

  it("lower-cases and trims a new email before changing it", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueGuard(queueResponse, "owner", "employee");

    await sendMemberPasswordResetCore({ ...input, newEmail: "  NEW@X.com " }, ctx(client));

    expect(updateUserById).toHaveBeenCalledWith("target", { email: "new@x.com", email_confirm: true });
    expect(profilesUpdate).toHaveBeenCalledWith("profiles", { email: "new@x.com" });
  });

  it("fails loudly when the profile mirror does not take", async () => {
    // Regression: this write was unchecked, so auth could hold the new address
    // while profiles still held the old one — the admin would see the change
    // apparently not take while sign-in had already moved.
    profilesUpdate.mockReturnValue({ error: { message: "rls refused" } });
    const { client, queueResponse } = createMockSupabase();
    queueGuard(queueResponse, "owner", "employee");

    await expect(sendMemberPasswordResetCore({ ...input, newEmail: "new@x.com" }, ctx(client)))
      .rejects.toThrow(/profile record could not be updated: rls refused/);
  });

  it("reports that no mail went out when no mail gateway is configured", async () => {
    // Regression: it returned a bare ok, so an admin was told the member had
    // been emailed when nothing had been sent.
    const { client, queueResponse } = createMockSupabase();
    queueGuard(queueResponse, "owner", "employee");

    const res = await sendMemberPasswordResetCore(input, ctx(client));
    expect(res.emailSent).toBe(false);
  });

  it("reports emailSent once the gateway accepts it", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const { client, queueResponse } = createMockSupabase();
    queueGuard(queueResponse, "owner", "employee");

    const res = await sendMemberPasswordResetCore(input, ctx(client));
    expect(res.emailSent).toBe(true);
    vi.unstubAllGlobals();
  });

  it("reports emailSent false when the gateway rejects it", async () => {
    process.env.RESEND_API_KEY = "re_test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "bad" }));

    const { client, queueResponse } = createMockSupabase();
    queueGuard(queueResponse, "owner", "employee");

    const res = await sendMemberPasswordResetCore(input, ctx(client));
    expect(res.emailSent).toBe(false);
    vi.unstubAllGlobals();
  });

  it("throws rather than pretending when no reset link can be produced", async () => {
    generateLink.mockResolvedValue({ data: null, error: { message: "nope" } });
    const { client, queueResponse } = createMockSupabase();
    queueGuard(queueResponse, "owner", "employee");

    await expect(sendMemberPasswordResetCore(input, ctx(client)))
      .rejects.toThrow("Could not generate reset link");
  });

  it("throws when the target has no resolvable email", async () => {
    getUserById.mockResolvedValue({ data: { user: null } });
    const { client, queueResponse } = createMockSupabase();
    queueGuard(queueResponse, "owner", "employee");

    await expect(sendMemberPasswordResetCore(input, ctx(client)))
      .rejects.toThrow("Could not resolve target email");
  });
});
