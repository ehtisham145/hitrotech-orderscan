import { describe, it, expect } from "vitest";
import { planAllows, minTierFor, isPlanActive, effectivePlanTier, type FeatureKey } from "./plan-features";

describe("planAllows", () => {
  it("free plan gets the baseline features only", () => {
    expect(planAllows("free", "partners")).toBe(true);
    expect(planAllows("free", "commissions")).toBe(false);
  });

  it("pro plan gets commissions/payouts, but not sso", () => {
    expect(planAllows("pro", "commissions")).toBe(true);
    expect(planAllows("pro", "payouts")).toBe(true);
    expect(planAllows("pro", "sso")).toBe(false);
  });

  it("enterprise plan gets everything including sso", () => {
    expect(planAllows("enterprise", "sso")).toBe(true);
  });

  it("treats a null/unknown tier as free", () => {
    expect(planAllows(null, "partners")).toBe(true);
    expect(planAllows("not-a-tier", "commissions")).toBe(false);
  });

  it("every plan gets every feature it claims to, per the matrix — regression guard", () => {
    // If a future edit drops a tier's array to [] by accident, every one of
    // these fails loudly instead of silently gating a paid feature off.
    const allFeatures: FeatureKey[] = [
      "partners", "leaderboard", "employees", "store_performance", "anomalies",
      "commissions", "payouts", "brand_earnings", "reconciliation", "reports",
      "scheduled_reports", "audit_log", "notifications", "priority_support", "sso",
    ];
    for (const feature of allFeatures) {
      expect(planAllows("enterprise", feature)).toBe(true);
    }
  });
});

describe("minTierFor", () => {
  it("finds the cheapest tier that unlocks a feature", () => {
    expect(minTierFor("partners")).toBe("free");
    expect(minTierFor("anomalies")).toBe("starter");
    expect(minTierFor("commissions")).toBe("pro");
    expect(minTierFor("sso")).toBe("enterprise");
  });
});

describe("isPlanActive", () => {
  it("free plan is always active regardless of expiry", () => {
    expect(isPlanActive("free", null)).toBe(true);
    expect(isPlanActive("free", "2000-01-01")).toBe(true);
  });

  it("a paid plan with no expiry set is treated as active", () => {
    expect(isPlanActive("pro", null)).toBe(true);
  });

  it("a paid plan with a future expiry is active", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(isPlanActive("pro", future)).toBe(true);
  });

  it("a paid plan with a past expiry is not active", () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(isPlanActive("pro", past)).toBe(false);
  });
});

describe("effectivePlanTier", () => {
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();

  it("keeps a paid tier while it is still in date", () => {
    expect(effectivePlanTier("pro", future)).toBe("pro");
    expect(effectivePlanTier("starter", future)).toBe("starter");
  });

  it("falls back to free once the plan has expired", () => {
    expect(effectivePlanTier("pro", past)).toBe("free");
    expect(effectivePlanTier("enterprise", past)).toBe("free");
  });

  it("treats a paid tier with no expiry as still active", () => {
    expect(effectivePlanTier("pro", null)).toBe("pro");
  });

  it("free stays free whatever the expiry says", () => {
    expect(effectivePlanTier("free", past)).toBe("free");
    expect(effectivePlanTier(null, past)).toBe("free");
    expect(effectivePlanTier(undefined, undefined)).toBe("free");
  });

  it("an expired workspace loses the features its stored tier would allow", () => {
    // The actual regression: the stored tier still says "pro", so a server
    // check reading plan_tier straight off the row kept handing out Pro.
    expect(planAllows("pro", "payouts")).toBe(true);
    expect(planAllows(effectivePlanTier("pro", past), "payouts")).toBe(false);
  });
});
