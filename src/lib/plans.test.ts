import { describe, it, expect } from "vitest";
import {
  getPlan,
  getPartnerLimit,
  getTermDiscountPct,
  computeTermPrice,
  tierRank,
  getPlanChangeType,
  remainingDays,
  computeProration,
} from "./plans";

describe("getPlan / getPartnerLimit", () => {
  it("finds a known tier", () => {
    expect(getPlan("pro").id).toBe("pro");
  });

  it("falls back to the free plan for an unknown/null tier", () => {
    expect(getPlan(null).id).toBe("free");
    expect(getPlan("not-a-real-tier").id).toBe("free");
  });

  it("returns the partner limit for a tier (null = unlimited)", () => {
    expect(getPartnerLimit("free")).toBe(1);
    expect(getPartnerLimit("starter")).toBeNull();
  });
});

describe("getTermDiscountPct", () => {
  it("returns the exact discount for a listed term", () => {
    expect(getTermDiscountPct(12)).toBe(20);
    expect(getTermDiscountPct(1)).toBe(0);
  });

  it("falls back to the best qualifying term for an unlisted duration", () => {
    // 9 months doesn't match any TERM_OPTIONS entry exactly, but qualifies
    // for the 6-month tier's discount (the highest one it clears).
    expect(getTermDiscountPct(9)).toBe(10);
  });

  it("returns 0 for a duration under the shortest term", () => {
    expect(getTermDiscountPct(0)).toBe(0);
  });
});

describe("computeTermPrice", () => {
  it("applies no discount for a 1-month term", () => {
    const r = computeTermPrice(10_000, 1);
    expect(r).toMatchObject({ gross: 10_000, discountPct: 0, discount: 0, total: 10_000, effectiveMonthly: 10_000 });
  });

  it("applies the 12-month (20%) discount correctly", () => {
    const r = computeTermPrice(10_000, 12);
    expect(r.gross).toBe(120_000);
    expect(r.discountPct).toBe(20);
    expect(r.discount).toBe(24_000);
    expect(r.total).toBe(96_000);
    expect(r.effectiveMonthly).toBe(8_000);
  });
});

describe("tierRank / getPlanChangeType", () => {
  it("ranks tiers in ascending order", () => {
    expect(tierRank("free")).toBe(0);
    expect(tierRank("enterprise")).toBe(3);
  });

  it("treats an unknown tier as free (rank 0)", () => {
    expect(tierRank("bogus")).toBe(0);
  });

  it("classifies moving to a higher tier as an upgrade", () => {
    expect(getPlanChangeType("starter", "pro")).toBe("upgrade");
  });

  it("classifies moving to a lower tier as a downgrade", () => {
    expect(getPlanChangeType("pro", "starter")).toBe("downgrade");
  });

  it("classifies staying on the same tier as a renewal", () => {
    expect(getPlanChangeType("pro", "pro")).toBe("renewal");
  });
});

describe("remainingDays", () => {
  it("returns 0 for a null expiry", () => {
    expect(remainingDays(null)).toBe(0);
  });

  it("returns 0 for an unparseable date", () => {
    expect(remainingDays("not-a-date")).toBe(0);
  });

  it("computes whole-ish days remaining to a future date", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const expires = new Date("2026-01-11T00:00:00Z");
    expect(remainingDays(expires, now)).toBe(10);
  });

  it("never returns negative (already-expired dates clamp to 0)", () => {
    const now = new Date("2026-01-11T00:00:00Z");
    const expires = new Date("2026-01-01T00:00:00Z");
    expect(remainingDays(expires, now)).toBe(0);
  });
});

describe("computeProration — real-money math", () => {
  const now = new Date("2026-06-15T00:00:00Z");

  it("a same-tier renewal charges the full new term with no credit", () => {
    const quote = computeProration({
      currentTier: "pro",
      currentExpiresAt: "2026-07-01T00:00:00Z",
      targetTier: "pro",
      months: 1,
      now,
    });
    expect(quote.changeType).toBe("renewal");
    expect(quote.credit).toBe(0);
    expect(quote.total).toBe(quote.subtotal);
    // The unused time is kept as time (carriedValue), not cashed out.
    expect(quote.carriedValue).toBeGreaterThan(0);
    expect(quote.refundable).toBe(0);
  });

  it("an upgrade credits the unused value of the current plan onto the invoice", () => {
    const quote = computeProration({
      currentTier: "starter",
      currentExpiresAt: "2026-07-15T00:00:00Z", // 30 days left
      currentPaidMonthly: 10_000,
      targetTier: "pro",
      months: 1,
      now,
    });
    expect(quote.changeType).toBe("upgrade");
    expect(quote.unusedValue).toBeGreaterThan(0);
    expect(quote.credit).toBeGreaterThan(0);
    expect(quote.credit).toBeLessThanOrEqual(quote.subtotal);
    expect(quote.total).toBe(quote.subtotal - quote.credit);
  });

  it("credit is capped at the new invoice's subtotal — never a negative total", () => {
    // Huge unused value (a year left on Pro, paid well above list) downgrading
    // to a much cheaper 1-month Starter term. Note: this specifically needs a
    // *catalog-priced* current tier — computeProration gates unusedValue on
    // getPlan(currentTier).pricePkr being truthy, so "enterprise" (pricePkr:
    // null, "contact us") always computes zero credit regardless of
    // currentPaidMonthly. That's existing behavior, not something this test
    // suite changes; using "pro" here exercises the cap logic this test is
    // actually about.
    const quote = computeProration({
      currentTier: "pro",
      currentExpiresAt: "2027-06-15T00:00:00Z", // ~365 days left
      currentPaidMonthly: 500_000,
      targetTier: "starter",
      months: 1,
      now,
    });
    expect(quote.total).toBeGreaterThanOrEqual(0);
    expect(quote.credit).toBeLessThanOrEqual(quote.subtotal);
    // Whatever unused value didn't fit on this invoice is refundable, not lost.
    expect(quote.refundable).toBeGreaterThan(0);
  });

  it("enterprise as the current tier computes zero credit regardless of currentPaidMonthly — documents the pricePkr:null gate", () => {
    const quote = computeProration({
      currentTier: "enterprise",
      currentExpiresAt: "2027-06-15T00:00:00Z",
      currentPaidMonthly: 500_000,
      targetTier: "starter",
      months: 1,
      now,
    });
    expect(quote.credit).toBe(0);
    expect(quote.unusedValue).toBe(0);
  });

  it("a fresh signup (no current plan/expiry) has zero credit", () => {
    const quote = computeProration({
      currentTier: null,
      currentExpiresAt: null,
      targetTier: "starter",
      months: 1,
      now,
    });
    expect(quote.credit).toBe(0);
    expect(quote.total).toBe(quote.subtotal);
  });

  it("total is never negative even with an oversized credit", () => {
    const quote = computeProration({
      currentTier: "pro",
      currentExpiresAt: "2030-01-01T00:00:00Z",
      currentPaidMonthly: 20_000,
      targetTier: "starter",
      months: 1,
      now,
    });
    expect(quote.total).toBeGreaterThanOrEqual(0);
  });
});
