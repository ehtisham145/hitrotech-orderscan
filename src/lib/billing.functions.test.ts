import { describe, it, expect, vi } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";
import {
  quoteForWorkspace,
  getBillingSettingsCore,
  updateBillingSettingsCore,
  getPlanChangeQuoteCore,
  createBillingRequestCore,
  listWorkspaceBillingRequestsCore,
  listAllBillingRequestsCore,
  approveBillingRequestCore,
  rejectBillingRequestCore,
  getWorkspacePlanCore,
  createRefundRequestCore,
  listWorkspaceRefundRequestsCore,
  listAllRefundRequestsCore,
  decideRefundRequestCore,
} from "./billing.functions";

// The privileged singleton write and the auto-apply path both reach for the
// service-role client. Stubbed so tests never construct a real one (it throws
// without EXT_SUPABASE_* env vars) and so writes can be asserted on.
const adminUpsert = vi.fn();
const adminUpdate = vi.fn();
const adminSelect = vi.fn();
vi.mock("@/integrations/supabase/ext-client.server", () => ({
  supabaseAdmin: {
    from: (_t: string) => ({
      upsert: (...a: unknown[]) => adminUpsert(...a),
      update: (...a: unknown[]) => adminUpdate(...a),
      select: (...a: unknown[]) => adminSelect(...a),
    }),
  },
}));

const ctx = (client: unknown) => ({ supabase: client as never, userId: "u1" });
const WS = "11111111-1111-4111-8111-111111111111";

describe("quoteForWorkspace", () => {
  it("prices a first paid plan with no credit, from a free workspace", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspaces", {
      data: { plan_tier: "free", plan_expires_at: null, plan_activated_at: null },
      error: null,
    });
    queueResponse("billing_requests", { data: null, error: null });

    const quote = await quoteForWorkspace(client, WS, "starter", 1);

    expect(quote.credit).toBe(0);
    expect(quote.total).toBe(quote.subtotal);
    expect(quote.subtotal).toBeGreaterThan(0);
  });

  it("derives the monthly rate from what was actually paid, not the list price", async () => {
    // A 6-month term billed at 30000 is 5000/month, and that is the number the
    // credit has to be based on — a customer who paid a discounted rate must
    // not be credited back at list price.
    const future = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspaces", {
      data: { plan_tier: "pro", plan_expires_at: future, plan_activated_at: "2026-01-01T00:00:00Z" },
      error: null,
    });
    queueResponse("billing_requests", {
      data: { amount_pkr: 30000, gross_pkr: 30000, months: 6, plan_tier: "pro", reviewed_at: "2026-01-01T00:00:00Z" },
      error: null,
    });

    const quote = await quoteForWorkspace(client, WS, "starter", 1);
    expect(quote.credit).toBeGreaterThan(0);
  });

  it("treats a term with months = 0 as having no derivable monthly rate", async () => {
    // Guards the division: months === 0 must not produce Infinity in a price.
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspaces", {
      data: { plan_tier: "pro", plan_expires_at: null, plan_activated_at: null },
      error: null,
    });
    queueResponse("billing_requests", {
      data: { amount_pkr: 1000, gross_pkr: 1000, months: 0, plan_tier: "pro", reviewed_at: null },
      error: null,
    });

    const quote = await quoteForWorkspace(client, WS, "starter", 1);
    expect(Number.isFinite(quote.total)).toBe(true);
    expect(Number.isFinite(quote.credit)).toBe(true);
  });

  it("surfaces a workspace lookup error instead of quoting from nothing", async () => {
    const { client, queueError } = createMockSupabase();
    queueError("workspaces", "ws gone");
    await expect(quoteForWorkspace(client, WS, "starter", 1)).rejects.toThrow("ws gone");
  });
});

describe("getBillingSettingsCore", () => {
  it("reads the single global row", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("billing_settings", { data: { id: "global", bank_name: "HBL" }, error: null });

    await expect(getBillingSettingsCore(ctx(client))).resolves.toMatchObject({ bank_name: "HBL" });
    expect(getChain("billing_settings").eq).toHaveBeenCalledWith("id", "global");
  });

  it("returns null when settings have never been saved", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("billing_settings", { data: null, error: null });
    await expect(getBillingSettingsCore(ctx(client))).resolves.toBeNull();
  });
});

const SETTINGS = {
  bank_name: "HBL", account_title: "Acme", account_number: "123", iban: "PK00",
  branch: "Main", branch_code: "01", instructions: "", contact_email: "a@b.c",
  contact_whatsapp: "0300",
};

describe("updateBillingSettingsCore", () => {
  it("refuses a caller who is not a super admin", async () => {
    const { client, queueRpc } = createMockSupabase();
    queueRpc("is_super_admin", { data: false, error: null });
    await expect(updateBillingSettingsCore(SETTINGS, ctx(client)))
      .rejects.toThrow("Only super admin can update billing settings");
    expect(adminUpsert).not.toHaveBeenCalled();
  });

  it("surfaces a role-check error rather than falling through to the write", async () => {
    const { client, queueRpc } = createMockSupabase();
    queueRpc("is_super_admin", { data: null, error: { message: "rpc down" } });
    await expect(updateBillingSettingsCore(SETTINGS, ctx(client))).rejects.toThrow();
  });

  it("throws when the upsert reports success but writes no row", async () => {
    const { client, queueRpc } = createMockSupabase();
    queueRpc("is_super_admin", { data: true, error: null });
    adminUpsert.mockReturnValueOnce({ select: () => ({ single: () => ({ data: null, error: null }) }) });
    await expect(updateBillingSettingsCore(SETTINGS, ctx(client)))
      .rejects.toThrow(/no row written/);
  });
});

describe("getPlanChangeQuoteCore", () => {
  it("refuses a caller without owner/admin on that workspace", async () => {
    const { client, queueRpc } = createMockSupabase();
    queueRpc("has_workspace_role", { data: false, error: null });
    await expect(getPlanChangeQuoteCore({ workspaceId: WS, planTier: "pro", months: 1 }, ctx(client)))
      .rejects.toThrow("Only workspace owners/admins can change the plan");
  });
});

describe("createBillingRequestCore", () => {
  it("refuses a caller without owner/admin", async () => {
    const { client, queueRpc } = createMockSupabase();
    queueRpc("has_workspace_role", { data: false, error: null });
    await expect(createBillingRequestCore(
      { workspaceId: WS, planTier: "pro", months: 1, paymentReference: null, payerNote: null, receiptPath: null },
      ctx(client),
    )).rejects.toThrow("Only workspace owners/admins can request a plan");
  });

  it("prices the request server-side and never from the caller's input", async () => {
    const { client, queueRpc, queueResponse, getChain } = createMockSupabase();
    queueRpc("has_workspace_role", { data: true, error: null });
    queueResponse("workspaces", { data: { plan_tier: "free", plan_expires_at: null, plan_activated_at: null }, error: null });
    queueResponse("billing_requests", { data: null, error: null });       // last paid lookup
    queueResponse("billing_requests", { data: { id: "req1" }, error: null }); // the insert

    const res = await createBillingRequestCore(
      { workspaceId: WS, planTier: "starter", months: 1, paymentReference: null, payerNote: null, receiptPath: null },
      ctx(client),
    );

    expect(res).toEqual({ id: "req1", autoApplied: false });
    const inserted = getChain("billing_requests", 1).insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.workspace_id).toBe(WS);
    expect(inserted.requested_by).toBe("u1");
    expect(Number(inserted.amount_pkr)).toBeGreaterThan(0);
  });

  it("forces months to 1 when switching to free, which has no term", async () => {
    const { client, queueRpc, queueResponse, getChain } = createMockSupabase();
    queueRpc("has_workspace_role", { data: true, error: null });
    queueResponse("workspaces", { data: { plan_tier: "free", plan_expires_at: null, plan_activated_at: null }, error: null });
    queueResponse("billing_requests", { data: null, error: null });
    queueResponse("billing_requests", { data: { id: "req2" }, error: null });
    adminUpdate.mockReturnValue({ eq: () => ({ error: null }) });

    await createBillingRequestCore(
      { workspaceId: WS, planTier: "free", months: 12, paymentReference: null, payerNote: null, receiptPath: null },
      ctx(client),
    );

    const inserted = getChain("billing_requests", 1).insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.months).toBe(1);
  });

  it("applies the change immediately when nothing is left to pay", async () => {
    // A downgrade whose unused credit covers the new term costs 0, and must not
    // sit waiting for an admin to confirm a payment that will never arrive.
    const { client, queueRpc, queueResponse } = createMockSupabase();
    queueRpc("has_workspace_role", { data: true, error: null });
    queueResponse("workspaces", { data: { plan_tier: "free", plan_expires_at: null, plan_activated_at: null }, error: null });
    queueResponse("billing_requests", { data: null, error: null });
    queueResponse("billing_requests", { data: { id: "req3" }, error: null });
    adminUpdate.mockReturnValue({ eq: () => ({ error: null }) });

    const res = await createBillingRequestCore(
      { workspaceId: WS, planTier: "free", months: 1, paymentReference: null, payerNote: null, receiptPath: null },
      ctx(client),
    );

    expect(res.autoApplied).toBe(true);
    // Both the workspace and the request row are updated, not just one.
    expect(adminUpdate).toHaveBeenCalledTimes(2);
    const wsWrite = adminUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(wsWrite.plan_tier).toBe("free");
    expect(wsWrite.plan_expires_at).toBeNull();   // free never expires
    expect(wsWrite.scheduled_plan_tier).toBeNull();
  });

  it("rejects a plan tier that is not in the catalogue", async () => {
    const { client, queueRpc } = createMockSupabase();
    queueRpc("has_workspace_role", { data: true, error: null });
    await expect(createBillingRequestCore(
      { workspaceId: WS, planTier: "gold" as never, months: 1, paymentReference: null, payerNote: null, receiptPath: null },
      ctx(client),
    )).rejects.toThrow("Invalid plan");
  });
});

describe("listWorkspaceBillingRequestsCore", () => {
  it("refuses a caller with no role on the workspace they asked about", async () => {
    // Regression: this used to trust the caller-supplied workspaceId and leave
    // RLS as the only guard on another workspace's invoice amounts.
    const { client, queueRpc } = createMockSupabase();
    queueRpc("has_workspace_role", { data: false, error: null });
    await expect(listWorkspaceBillingRequestsCore({ workspaceId: WS }, ctx(client)))
      .rejects.toThrow("Only workspace owners/admins can view billing requests");
  });

  it("returns the workspace's own requests for an authorized caller", async () => {
    const { client, queueRpc, queueResponse, getChain } = createMockSupabase();
    queueRpc("has_workspace_role", { data: true, error: null });
    queueResponse("billing_requests", { data: [{ id: "r1" }], error: null });

    await expect(listWorkspaceBillingRequestsCore({ workspaceId: WS }, ctx(client)))
      .resolves.toEqual([{ id: "r1" }]);
    expect(getChain("billing_requests").eq).toHaveBeenCalledWith("workspace_id", WS);
  });

  it("surfaces a query error", async () => {
    const { client, queueRpc, queueError } = createMockSupabase();
    queueRpc("has_workspace_role", { data: true, error: null });
    queueError("billing_requests", "boom");
    await expect(listWorkspaceBillingRequestsCore({ workspaceId: WS }, ctx(client))).rejects.toThrow("boom");
  });
});

describe("listAllBillingRequestsCore", () => {
  it("is super-admin only", async () => {
    const { client, queueRpc } = createMockSupabase();
    queueRpc("is_super_admin", { data: false, error: null });
    await expect(listAllBillingRequestsCore(ctx(client))).rejects.toThrow("Forbidden");
  });

  it("attaches each requester's profile, and null where there is none", async () => {
    const { client, queueRpc, queueResponse } = createMockSupabase();
    queueRpc("is_super_admin", { data: true, error: null });
    queueResponse("billing_requests", {
      data: [{ id: "r1", requested_by: "u1" }, { id: "r2", requested_by: "ghost" }],
      error: null,
    });
    queueResponse("profiles", { data: [{ id: "u1", email: "a@b.c", full_name: "Ali" }], error: null });

    const rows = await listAllBillingRequestsCore(ctx(client));
    expect(rows[0].profiles).toEqual({ email: "a@b.c", full_name: "Ali" });
    expect(rows[1].profiles).toBeNull();
  });

  it("skips the profile lookup entirely when there are no requests", async () => {
    const { client, queueRpc, queueResponse } = createMockSupabase();
    queueRpc("is_super_admin", { data: true, error: null });
    queueResponse("billing_requests", { data: [], error: null });
    // No "profiles" response queued — the mock throws if it is queried, which
    // is the assertion: an empty list must not fan out to a second query.
    await expect(listAllBillingRequestsCore(ctx(client))).resolves.toEqual([]);
  });
});

describe("approveBillingRequestCore / rejectBillingRequestCore", () => {
  it("approve delegates to the SQL function and passes the note through", async () => {
    const { client, queueRpc, rpc } = createMockSupabase();
    queueRpc("approve_billing_request", { data: null, error: null });
    await expect(approveBillingRequestCore({ requestId: "r1", adminNote: "paid" }, ctx(client)))
      .resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("approve_billing_request", { _request_id: "r1", _admin_note: "paid" });
  });

  it("approve surfaces a failure instead of reporting ok", async () => {
    const { client, queueRpc } = createMockSupabase();
    queueRpc("approve_billing_request", { data: null, error: { message: "not pending" } });
    await expect(approveBillingRequestCore({ requestId: "r1", adminNote: null }, ctx(client))).rejects.toThrow();
  });

  it("reject delegates to its own SQL function", async () => {
    const { client, queueRpc, rpc } = createMockSupabase();
    queueRpc("reject_billing_request", { data: null, error: null });
    await expect(rejectBillingRequestCore({ requestId: "r1", adminNote: null }, ctx(client)))
      .resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("reject_billing_request", { _request_id: "r1", _admin_note: undefined });
  });
});

describe("getWorkspacePlanCore", () => {
  it("returns the plan with defaults filled in for missing columns", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueResponse("workspaces", { data: { id: WS, name: "Acme" }, error: null });

    const plan = await getWorkspacePlanCore({ workspaceId: WS }, ctx(client));
    expect(plan).toMatchObject({ id: WS, name: "Acme", plan_tier: "free", seat_limit: 2 });
    expect(plan!.plan_expires_at).toBeNull();
  });

  it("returns null for a workspace the caller cannot see and is not super admin for", async () => {
    const { client, queueResponse, queueRpc } = createMockSupabase();
    queueResponse("workspaces", { data: null, error: null });
    queueRpc("is_super_admin", { data: false, error: null });
    await expect(getWorkspacePlanCore({ workspaceId: WS }, ctx(client))).resolves.toBeNull();
  });
});

describe("createRefundRequestCore", () => {
  it("refuses a caller without owner/admin", async () => {
    const { client, queueRpc } = createMockSupabase();
    queueRpc("has_workspace_role", { data: false, error: null });
    await expect(createRefundRequestCore(
      { workspaceId: WS, amountPkr: 100, reason: null, bankDetails: null },
      ctx(client),
    )).rejects.toThrow(/owner|admin/i);
  });
});

describe("listWorkspaceRefundRequestsCore / listAllRefundRequestsCore", () => {
  it("scopes the workspace listing to the workspace asked for", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("refund_requests", { data: [{ id: "rf1" }], error: null });
    await listWorkspaceRefundRequestsCore({ workspaceId: WS }, ctx(client));
    expect(getChain("refund_requests").eq).toHaveBeenCalledWith("workspace_id", WS);
  });

  it("the all-workspaces listing is super-admin only", async () => {
    const { client, queueRpc } = createMockSupabase();
    queueRpc("is_super_admin", { data: false, error: null });
    await expect(listAllRefundRequestsCore(ctx(client))).rejects.toThrow(/Forbidden/i);
  });
});

describe("decideRefundRequestCore", () => {
  it("is super-admin only", async () => {
    const { client, queueRpc } = createMockSupabase();
    queueRpc("is_super_admin", { data: false, error: null });
    await expect(decideRefundRequestCore(
      { requestId: "rf1", approve: true, adminNote: null } as never,
      ctx(client),
    )).rejects.toThrow(/Forbidden/i);
  });
});
