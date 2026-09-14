import { describe, it, expect } from "vitest";
import { slabsEffectiveOn, effectiveLabel, computeSlabAmount, type Slab } from "./brand-slabs";

describe("slabsEffectiveOn", () => {
  const always: Slab = { min_count: 1, max_count: 50, rate_pkr: 100 };
  const janToJune: Slab = { min_count: 1, max_count: 50, rate_pkr: 90, effective_from: "2026-01-01", effective_to: "2026-06-30" };
  const julOnwards: Slab = { min_count: 1, max_count: 50, rate_pkr: 110, effective_from: "2026-07-01" };

  it("includes a slab with no date bounds on any day", () => {
    expect(slabsEffectiveOn([always], "2020-01-01")).toEqual([always]);
  });

  it("excludes a slab before its effective_from", () => {
    expect(slabsEffectiveOn([julOnwards], "2026-06-30")).toEqual([]);
  });

  it("includes a slab on its effective_from day itself (inclusive)", () => {
    expect(slabsEffectiveOn([julOnwards], "2026-07-01")).toEqual([julOnwards]);
  });

  it("excludes a slab after its effective_to", () => {
    expect(slabsEffectiveOn([janToJune], "2026-07-01")).toEqual([]);
  });

  it("includes a slab on its effective_to day itself (inclusive)", () => {
    expect(slabsEffectiveOn([janToJune], "2026-06-30")).toEqual([janToJune]);
  });
});

describe("effectiveLabel", () => {
  it("labels an always-active slab", () => {
    expect(effectiveLabel({ min_count: 1, max_count: null, rate_pkr: 0 })).toBe("Always");
  });

  it("labels a from-only slab", () => {
    expect(effectiveLabel({ min_count: 1, max_count: null, rate_pkr: 0, effective_from: "2026-01-01" })).toBe("From 2026-01-01");
  });

  it("labels a to-only slab", () => {
    expect(effectiveLabel({ min_count: 1, max_count: null, rate_pkr: 0, effective_to: "2026-01-01" })).toBe("Until 2026-01-01");
  });

  it("labels a bounded-window slab", () => {
    expect(
      effectiveLabel({ min_count: 1, max_count: null, rate_pkr: 0, effective_from: "2026-01-01", effective_to: "2026-06-30" }),
    ).toBe("2026-01-01 → 2026-06-30");
  });
});

describe("computeSlabAmount", () => {
  const tiers: Slab[] = [
    { min_count: 1, max_count: 50, rate_pkr: 500 },
    { min_count: 51, max_count: 150, rate_pkr: 750 },
    { min_count: 151, max_count: null, rate_pkr: 1000 },
  ];

  it("applies the flat rate for the matching tier to every unit, not progressively", () => {
    // 120 activations land in the 51-150 tier -> 120 * 750, NOT 50*500 + 70*750.
    const result = computeSlabAmount(120, tiers);
    expect(result.total).toBe(120 * 750);
    expect(result.breakdown).toHaveLength(1);
  });

  it("uses the highest tier's rate when the count exceeds every bounded tier", () => {
    const unboundedOnly: Slab[] = [{ min_count: 1, max_count: 50, rate_pkr: 500 }];
    const result = computeSlabAmount(200, unboundedOnly);
    expect(result.total).toBe(200 * 500);
  });

  it("returns 0 for a zero/negative count", () => {
    expect(computeSlabAmount(0, tiers).total).toBe(0);
    expect(computeSlabAmount(-5, tiers).total).toBe(0);
  });

  it("returns 0 when there are no tiers at all", () => {
    expect(computeSlabAmount(100, []).total).toBe(0);
  });

  it("ignores inactive (active: false) tiers", () => {
    const withInactive: Slab[] = [
      { min_count: 1, max_count: 50, rate_pkr: 500, active: false },
      { min_count: 1, max_count: null, rate_pkr: 999, active: true },
    ];
    const result = computeSlabAmount(10, withInactive);
    expect(result.total).toBe(10 * 999);
  });

  it("only considers tiers effective on the given date", () => {
    const dated: Slab[] = [
      { min_count: 1, max_count: null, rate_pkr: 500, effective_to: "2026-06-30" },
      { min_count: 1, max_count: null, rate_pkr: 750, effective_from: "2026-07-01" },
    ];
    expect(computeSlabAmount(10, dated, "2026-03-01").total).toBe(10 * 500);
    expect(computeSlabAmount(10, dated, "2026-08-01").total).toBe(10 * 750);
  });
});
