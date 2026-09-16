import { describe, it, expect } from "vitest";
import { normalizeCompensationType, monthlyEarnings } from "./employee-pay";

describe("normalizeCompensationType", () => {
  it("accepts a known compensation type", () => {
    expect(normalizeCompensationType("commission_only")).toBe("commission_only");
  });

  it("falls back to 'fixed' for an unknown value", () => {
    expect(normalizeCompensationType("bogus")).toBe("fixed");
    expect(normalizeCompensationType(undefined)).toBe("fixed");
    expect(normalizeCompensationType(null)).toBe("fixed");
  });
});

describe("monthlyEarnings", () => {
  it("fixed: pays only the base salary, ignoring any rate/activations", () => {
    const r = monthlyEarnings({ compensation_type: "fixed", salary: 50_000, commission_per_activation: 100, activations: 40 });
    expect(r).toMatchObject({ baseSalary: 50_000, ratePerActivation: 0, commission: 0, gross: 50_000 });
  });

  it("commission_only: pays only per-activation, ignoring any salary field", () => {
    const r = monthlyEarnings({ compensation_type: "commission_only", salary: 50_000, commission_per_activation: 100, activations: 40 });
    expect(r).toMatchObject({ baseSalary: 0, ratePerActivation: 100, commission: 4_000, gross: 4_000 });
  });

  it("salary_plus_commission: pays both, summed", () => {
    const r = monthlyEarnings({ compensation_type: "salary_plus_commission", salary: 20_000, commission_per_activation: 50, activations: 40 });
    expect(r).toMatchObject({ baseSalary: 20_000, ratePerActivation: 50, commission: 2_000, gross: 22_000 });
  });

  it("treats missing salary/rate as 0, not NaN", () => {
    const r = monthlyEarnings({ compensation_type: "salary_plus_commission", activations: 10 });
    expect(r.gross).toBe(0);
    expect(Number.isNaN(r.gross)).toBe(false);
  });

  it("zero activations means zero commission regardless of type", () => {
    const r = monthlyEarnings({ compensation_type: "commission_only", commission_per_activation: 100, activations: 0 });
    expect(r.commission).toBe(0);
  });
});
