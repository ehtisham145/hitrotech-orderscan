import { describe, it, expect } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";
import {
  listPartnersCore,
  getPartnerCore,
  createPartnerCore,
  updatePartnerCore,
  deletePartnerCore,
  addPartnerMatchKeyCore,
  type PartnerInput,
} from "./partners.functions";

const PROFILE = { data: { active_workspace_id: "ws1" }, error: null };
const ctx = (client: unknown) => ({ supabase: client as never, userId: "u1" });

const PARTNER_INPUT: PartnerInput = {
  name: "Retailer One",
  role: "retailer",
  match_keys: [],
  active: true,
};

describe("listPartnersCore", () => {
  it("scopes the list to the caller's workspace", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partners", { data: [{ id: "p1", name: "A" }], error: null });

    const rows = await listPartnersCore(ctx(client));

    expect(rows).toEqual([{ id: "p1", name: "A" }]);
    expect(getChain("partners").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });

  it("returns an empty array rather than null", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partners", { data: null, error: null });
    await expect(listPartnersCore(ctx(client))).resolves.toEqual([]);
  });

  it("surfaces a query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("partners", "boom");
    await expect(listPartnersCore(ctx(client))).rejects.toThrow("boom");
  });
});

describe("getPartnerCore", () => {
  it("scopes the lookup to the caller's workspace", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partners", { data: { id: "p1" }, error: null });

    await getPartnerCore({ id: "p1" }, ctx(client));

    const chain = getChain("partners");
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("id", "p1");
  });

  it("returns null for an id from another workspace instead of leaking it", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("partners", { data: null, error: null });
    await expect(getPartnerCore({ id: "other-ws" }, ctx(client))).resolves.toBeNull();
  });

  it("surfaces a query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("partners", "boom");
    await expect(getPartnerCore({ id: "p1" }, ctx(client))).rejects.toThrow("boom");
  });
});

describe("createPartnerCore", () => {
  it("creates the partner scoped to the workspace when under the plan limit", async () => {
    const { client, queueResponse, queueRpc, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueRpc("is_super_admin", { data: false, error: null });
    queueResponse("workspaces", { data: { plan_tier: "starter", plan_expires_at: null }, error: null });
    // starter plan has an unlimited partnerLimit (null), so no count check happens
    queueResponse("partners", { data: { id: "p1", ...PARTNER_INPUT }, error: null });

    const result = await createPartnerCore(PARTNER_INPUT, ctx(client));

    expect(result).toMatchObject({ ok: true });
    expect(getChain("partners").insert).toHaveBeenCalledWith(
      expect.objectContaining({ workspace_id: "ws1", created_by: "u1", name: "Retailer One" }),
    );
  });

  it("refuses a caller without the write role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(createPartnerCore(PARTNER_INPUT, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("returns a plan-limit error instead of inserting once the free-tier cap is hit", async () => {
    const { client, queueResponse, queueRpc, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueRpc("is_super_admin", { data: false, error: null });
    queueResponse("workspaces", { data: { plan_tier: "free", plan_expires_at: null }, error: null });
    queueResponse("partners", { data: null, error: null, count: 1 } as never); // free plan limit is 1

    const result = await createPartnerCore(PARTNER_INPUT, ctx(client));

    expect(result).toEqual({ ok: false, error: "Your current plan allows only 1 partner. Upgrade to add more." });
    // No insert should have been attempted.
    expect(() => getChain("partners", 1)).toThrow();
  });

  it("skips the count/limit check entirely for a super admin", async () => {
    const { client, queueResponse, queueRpc, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueRpc("is_super_admin", { data: true, error: null });
    queueResponse("workspaces", { data: { plan_tier: "free", plan_expires_at: null }, error: null });
    // No count lookup queued — proves the count check itself is skipped for a super admin.
    queueResponse("partners", { data: { id: "p1", ...PARTNER_INPUT }, error: null });

    await expect(createPartnerCore(PARTNER_INPUT, ctx(client))).resolves.toMatchObject({ ok: true });
    expect(() => getChain("partners", 1)).toThrow();
  });

  it("turns a duplicate-CNIC violation into a readable message instead of a raw db error", async () => {
    const { client, queueResponse, queueRpc, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueRpc("is_super_admin", { data: true, error: null });
    queueResponse("workspaces", { data: { plan_tier: "free", plan_expires_at: null }, error: null });
    queueResponse("partners", { data: null, error: { message: "dup", code: "23505" } as never });

    const result = await createPartnerCore(PARTNER_INPUT, ctx(client));
    expect(result).toEqual({ ok: false, error: "A partner with this CNIC already exists." });
  });

  it("surfaces the is_super_admin rpc error instead of silently treating the caller as non-admin", async () => {
    const { client, queueResponse, queueRpc, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueRpc("is_super_admin", { data: null, error: { message: "rpc boom" } });
    await expect(createPartnerCore(PARTNER_INPUT, ctx(client))).rejects.toThrow("rpc boom");
  });

  it("surfaces a workspace-lookup error during the limit check", async () => {
    const { client, queueResponse, queueRpc, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueRpc("is_super_admin", { data: false, error: null });
    queueError("workspaces", "ws boom");
    await expect(createPartnerCore(PARTNER_INPUT, ctx(client))).rejects.toThrow("ws boom");
  });

  it("surfaces a count-check error rather than silently allowing the create", async () => {
    const { client, queueResponse, queueRpc, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueRpc("is_super_admin", { data: false, error: null });
    queueResponse("workspaces", { data: { plan_tier: "free", plan_expires_at: null }, error: null });
    queueError("partners", "count boom");
    await expect(createPartnerCore(PARTNER_INPUT, ctx(client))).rejects.toThrow("count boom");
  });
});

describe("updatePartnerCore", () => {
  it("scopes the update by workspace_id and id", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("partners", { data: { id: "p1", name: "Edited" }, error: null });

    const result = await updatePartnerCore({ id: "p1", name: "Edited" }, ctx(client));

    expect(result).toMatchObject({ ok: true });
    const chain = getChain("partners");
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("id", "p1");
  });

  it("refuses a caller without the write role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(updatePartnerCore({ id: "p1", name: "X" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("turns a duplicate-CNIC violation into a readable message", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("partners", { data: null, error: { message: "dup", code: "23505" } as never });

    const result = await updatePartnerCore({ id: "p1", cnic: "12345" }, ctx(client));
    expect(result).toEqual({ ok: false, error: "A partner with this CNIC already exists." });
  });
});

describe("deletePartnerCore", () => {
  it("deletes only within the caller's workspace", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("partners", { data: null, error: null });

    await expect(deletePartnerCore({ id: "p1" }, ctx(client))).resolves.toEqual({ ok: true });

    const chain = getChain("partners");
    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("id", "p1");
  });

  it("refuses a caller without the write role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(deletePartnerCore({ id: "p1" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("surfaces a delete error", async () => {
    const { client, queueResponse, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueError("partners", "boom");
    await expect(deletePartnerCore({ id: "p1" }, ctx(client))).rejects.toThrow("boom");
  });
});

describe("addPartnerMatchKeyCore", () => {
  it("adds the new key while keeping the partner's existing keys", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("partners", { data: { match_keys: ["old-key"] }, error: null });
    queueResponse("partners", { data: null, error: null });

    await expect(addPartnerMatchKeyCore({ id: "p1", key: "new-key" }, ctx(client))).resolves.toEqual({ ok: true });

    expect(getChain("partners", 1).update).toHaveBeenCalledWith({ match_keys: ["old-key", "new-key"] });
  });

  it("de-duplicates and trims keys", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("partners", { data: { match_keys: ["A", "  A  ", ""] }, error: null });
    queueResponse("partners", { data: null, error: null });

    await addPartnerMatchKeyCore({ id: "p1", key: "  A  " }, ctx(client));

    expect(getChain("partners", 1).update).toHaveBeenCalledWith({ match_keys: ["A"] });
  });

  it("fails instead of silently wiping existing keys when the lookup errors", async () => {
    // Previously this select's error was discarded — a failed lookup (e.g. an
    // id from another workspace) fell through to an empty key set and the
    // update that followed overwrote the row, discarding every key it had.
    const { client, queueResponse, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueError("partners", "not found in this workspace");

    await expect(addPartnerMatchKeyCore({ id: "other-ws-partner", key: "x" }, ctx(client)))
      .rejects.toThrow("not found in this workspace");
  });

  it("refuses a caller without the write role", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(addPartnerMatchKeyCore({ id: "p1", key: "x" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("surfaces the final update error", async () => {
    const { client, queueResponse, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("partners", { data: { match_keys: [] }, error: null });
    queueError("partners", "update boom");
    await expect(addPartnerMatchKeyCore({ id: "p1", key: "x" }, ctx(client))).rejects.toThrow("update boom");
  });
});
