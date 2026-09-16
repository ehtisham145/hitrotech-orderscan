import { describe, it, expect } from "vitest";
import { createMockSupabase } from "./test-utils/mock-supabase";
import {
  listBrandsCore,
  upsertBrandCore,
  deleteBrandCore,
  listBrandSlabsCore,
  upsertBrandSlabCore,
  deleteBrandSlabCore,
  getAgencyEarningsCore,
  saveBrandInvoiceCore,
  markBrandInvoiceReceivedCore,
} from "./brand.functions";

const PROFILE = { data: { active_workspace_id: "ws1" }, error: null };
const ctx = (client: unknown) => ({ supabase: client as never, userId: "u1" });
const ok = { data: null, error: null };

/** The four parallel reads getAgencyEarningsCore starts with, in order. */
function queueEarnings(
  q: ReturnType<typeof createMockSupabase>["queueResponse"],
  opts: {
    brands?: unknown[];
    rows?: unknown[];
    partners?: unknown[];
    employees?: unknown[];
    slabs?: unknown[];
    invoice?: unknown;
  } = {},
) {
  q("profiles", PROFILE);
  q("brands", { data: opts.brands ?? [], error: null });
  q("extractions", { data: opts.rows ?? [], error: null });
  q("partners", { data: opts.partners ?? [], error: null });
  q("employees", { data: opts.employees ?? [], error: null });
  if (opts.brands?.length) {
    q("brand_slabs", { data: opts.slabs ?? [], error: null });
    q("brand_invoices", { data: opts.invoice ?? null, error: null });
  }
}

describe("listBrandsCore", () => {
  it("lists the workspace's brands", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("brands", { data: [{ id: "b1", name: "Onic" }], error: null });

    await expect(listBrandsCore(ctx(client))).resolves.toEqual([{ id: "b1", name: "Onic" }]);
    expect(getChain("brands").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });
});

describe("upsertBrandCore", () => {
  it("refuses a caller without owner/admin", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(upsertBrandCore({ name: "Onic" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("stamps the workspace on a new brand", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("brands", { data: { id: "b1" }, error: null });

    await expect(upsertBrandCore({ name: "Onic" }, ctx(client))).resolves.toEqual({ ok: true, id: "b1" });
    expect(getChain("brands").insert).toHaveBeenCalledWith({ name: "Onic", workspace_id: "ws1" });
  });

  it("scopes an edit by workspace and id", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("brands", { data: [{ id: "b1" }], error: null });

    await expect(upsertBrandCore({ id: "b1", name: "Onic" }, ctx(client))).resolves.toEqual({ ok: true, id: "b1" });
    const chain = getChain("brands");
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("id", "b1");
  });

  it("reports an edit that matched nothing rather than returning ok", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("brands", { data: [], error: null });

    await expect(upsertBrandCore({ id: "other-ws", name: "Onic" }, ctx(client)))
      .resolves.toEqual({ ok: false, error: "Brand not found in this workspace" });
  });

  it("returns the database error rather than throwing", async () => {
    const { client, queueResponse, allowRole, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueError("brands", "insert refused");
    await expect(upsertBrandCore({ name: "Onic" }, ctx(client)))
      .resolves.toEqual({ ok: false, error: "insert refused" });
  });
});

describe("deleteBrandCore", () => {
  it("deletes only within the caller's workspace", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("brands", ok);

    await expect(deleteBrandCore({ id: "b1" }, ctx(client))).resolves.toEqual({ ok: true });
    const chain = getChain("brands");
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("id", "b1");
  });

  it("refuses a caller without owner/admin", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(deleteBrandCore({ id: "b1" }, ctx(client))).rejects.toThrow(/Forbidden/);
  });
});

describe("listBrandSlabsCore", () => {
  it("scopes to the workspace and the brand asked for", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("brand_slabs", { data: [], error: null });

    await listBrandSlabsCore({ brand_id: "b1" }, ctx(client));
    const chain = getChain("brand_slabs");
    expect(chain.eq).toHaveBeenCalledWith("workspace_id", "ws1");
    expect(chain.eq).toHaveBeenCalledWith("brand_id", "b1");
  });

  it("surfaces a query error", async () => {
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueError("brand_slabs", "boom");
    await expect(listBrandSlabsCore({ brand_id: "b1" }, ctx(client))).rejects.toThrow("boom");
  });
});

const SLAB = { brand_id: "b1", min_count: 1, max_count: 10, rate_pkr: 300, active: true };

describe("upsertBrandSlabCore / deleteBrandSlabCore", () => {
  it("refuses a caller without owner/admin", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(upsertBrandSlabCore(SLAB, ctx(client))).rejects.toThrow(/Forbidden/);
  });

  it("stamps the workspace on a new slab", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("brand_slabs", ok);

    await expect(upsertBrandSlabCore(SLAB, ctx(client))).resolves.toEqual({ ok: true });
    expect(getChain("brand_slabs").insert).toHaveBeenCalledWith({ ...SLAB, workspace_id: "ws1" });
  });

  it("reports an edit that matched nothing", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("brand_slabs", { data: [], error: null });

    await expect(upsertBrandSlabCore({ ...SLAB, id: "other-ws" }, ctx(client)))
      .resolves.toEqual({ ok: false, error: "Slab not found in this workspace" });
  });

  it("delete is scoped to the workspace", async () => {
    const { client, queueResponse, allowRole, getChain } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole();
    queueResponse("brand_slabs", ok);

    await deleteBrandSlabCore({ id: "s1" }, ctx(client));
    expect(getChain("brand_slabs").eq).toHaveBeenCalledWith("workspace_id", "ws1");
  });
});

describe("getAgencyEarningsCore", () => {
  it("normalises a bare YYYY-MM input (no day component) correctly", async () => {
    // Regression guard: monthStart used to build this via
    // `input.slice(0, 8) + "01"`, valid only for a 10-char "YYYY-MM-DD"
    // input. A 7-char "YYYY-MM" input (what a parameter named `month`
    // invites) came out as "2026-0901" — no dash, not a parseable date.
    const { client, queueResponse } = createMockSupabase();
    queueEarnings(queueResponse);
    const result = await getAgencyEarningsCore({ month: "2026-09" }, ctx(client));
    expect(result.month).toBe("2026-09-01");
  });

  it("refuses to report zeros when a source query failed", async () => {
    // Regression: all four parallel reads were taken as `.data ?? []` with the
    // error discarded, so a failure looked exactly like a quiet month — zero
    // revenue, zero cost, no indication anything was wrong.
    const { client, queueResponse, queueError } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    queueResponse("brands", { data: [], error: null });
    queueError("extractions", "activations unavailable");
    queueResponse("partners", { data: [], error: null });
    queueResponse("employees", { data: [], error: null });

    await expect(getAgencyEarningsCore({ month: "2026-09" }, ctx(client)))
      .rejects.toThrow(/Could not load activations.*activations unavailable/);
  });

  it("scopes every source query to the caller's workspace", async () => {
    const { client, queueResponse, getChain } = createMockSupabase();
    queueEarnings(queueResponse);

    await getAgencyEarningsCore({ month: "2026-09" }, ctx(client));

    for (const t of ["brands", "extractions", "partners", "employees"]) {
      expect(getChain(t).eq).toHaveBeenCalledWith("workspace_id", "ws1");
    }
  });

  it("counts every activation as revenue, but only assigned ones as partner cost", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueEarnings(queueResponse, {
      brands: [{ id: "b1", name: "Onic", active: true }],
      rows: [
        { partner_id: "p1", commission_amount: 100 },
        { partner_id: "p1", commission_amount: 100 },
        { partner_id: null, commission_amount: 0 },   // unassigned still bills the brand
      ],
      partners: [{ id: "p1", name: "Ali", role: "retailer", store_id: "S1" }],
      employees: [{ salary: 50000 }],
      slabs: [{ id: "s1", min_count: 1, max_count: null, rate_pkr: 500, active: true }],
    });

    const res = await getAgencyEarningsCore({ month: "2026-09" }, ctx(client));

    expect(res.total_activations).toBe(3);
    expect(res.partner_cost).toBe(200);
    expect(res.employee_cost).toBe(50000);
    expect(res.total_expenses).toBe(50200);
    expect(res.unassigned_activations).toBe(1);
    expect(res.margin).toBe(res.brand_revenue - res.total_expenses);
  });

  it("splits brand revenue across partners by their share of activations", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueEarnings(queueResponse, {
      brands: [{ id: "b1", name: "Onic", active: true }],
      rows: [
        { partner_id: "p1", commission_amount: 100 },
        { partner_id: "p2", commission_amount: 100 },
      ],
      partners: [
        { id: "p1", name: "Ali", role: "retailer", store_id: null },
        { id: "p2", name: "Sara", role: "retailer", store_id: null },
      ],
      slabs: [{ id: "s1", min_count: 1, max_count: null, rate_pkr: 500, active: true }],
    });

    const res = await getAgencyEarningsCore({ month: "2026-09" }, ctx(client));

    // Two activations at 500 each; each partner brought one.
    expect(res.brand_revenue).toBe(1000);
    expect(res.contributions).toHaveLength(2);
    expect(res.contributions[0]).toMatchObject({ count: 1, partner_cost: 100, brand_revenue: 500, margin: 400 });
  });

  it("reports an empty month without dividing by zero", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueEarnings(queueResponse, { brands: [{ id: "b1", name: "Onic", active: true }] });

    const res = await getAgencyEarningsCore({ month: "2026-09" }, ctx(client));
    expect(res.total_activations).toBe(0);
    expect(res.brand_revenue).toBe(0);
    expect(Number.isFinite(res.brand_revenue)).toBe(true);
    expect(res.contributions).toEqual([]);
  });

  it("copes with a workspace that has no brand configured yet", async () => {
    const { client, queueResponse } = createMockSupabase();
    queueEarnings(queueResponse, { rows: [{ partner_id: null, commission_amount: 0 }] });

    const res = await getAgencyEarningsCore({ month: "2026-09" }, ctx(client));
    expect(res.brand_revenue).toBe(0);
    expect(res.total_activations).toBe(1);
  });
});

describe("saveBrandInvoiceCore / markBrandInvoiceReceivedCore", () => {
  it("save refuses a caller without owner/admin", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(saveBrandInvoiceCore({ brand_id: "b1", month: "2026-09" } as never, ctx(client)))
      .rejects.toThrow(/Forbidden/);
  });

  it("mark-received refuses a caller without owner/admin", async () => {
    const { client, queueResponse, allowRole } = createMockSupabase();
    queueResponse("profiles", PROFILE);
    allowRole(false);
    await expect(markBrandInvoiceReceivedCore({ id: "i1" } as never, ctx(client)))
      .rejects.toThrow(/Forbidden/);
  });
});
