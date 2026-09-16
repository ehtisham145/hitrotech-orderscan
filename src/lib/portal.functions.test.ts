import { describe, it, expect } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";
import { getMyPartnerCore, listMyPayoutsCore } from "./portal.functions";

const ctx = (client: unknown) => ({ supabase: client as never, userId: "u1" });

describe("getMyPartnerCore", () => {
  it("scopes the lookup to the caller's own account", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("partners", { data: { id: "p1", user_id: "u1" }, error: null });

    const result = await getMyPartnerCore(ctx(client));

    expect(result).toEqual({ id: "p1", user_id: "u1" });
    expect(getChain("partners").eq).toHaveBeenCalledWith("user_id", "u1");
  });

  it("returns null when this account isn't linked to a partner", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("partners", { data: null, error: null });
    await expect(getMyPartnerCore(ctx(client))).resolves.toBeNull();
  });

  it("surfaces a query error", async () => {
    const { client, queueError } = createMockSupabase();
    queueError("partners", "boom");
    await expect(getMyPartnerCore(ctx(client))).rejects.toThrow("boom");
  });
});

describe("listMyPayoutsCore", () => {
  it("lists payouts for the caller's own partner record", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("partners", { data: { id: "p1" }, error: null });
    queueResponse("partner_payouts", { data: [{ id: "pay1", month: "2026-09-01" }], error: null });

    const result = await listMyPayoutsCore(ctx(client));

    expect(result).toEqual([{ id: "pay1", month: "2026-09-01" }]);
    expect(getChain("partner_payouts").eq).toHaveBeenCalledWith("partner_id", "p1");
  });

  it("returns an empty list when this account isn't linked to a partner", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("partners", { data: null, error: null });
    await expect(listMyPayoutsCore(ctx(client))).resolves.toEqual([]);
    expect(() => getChain("partner_payouts")).toThrow();
  });

  it("fails instead of reporting an empty payout list when the partner lookup errors", async () => {
    const { client, queueError } = createMockSupabase();
    queueError("partners", "lookup boom");
    await expect(listMyPayoutsCore(ctx(client))).rejects.toThrow("lookup boom");
  });

  it("surfaces the payouts query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("partners", { data: { id: "p1" }, error: null });
    queueError("partner_payouts", "boom");
    await expect(listMyPayoutsCore(ctx(client))).rejects.toThrow("boom");
  });
});
