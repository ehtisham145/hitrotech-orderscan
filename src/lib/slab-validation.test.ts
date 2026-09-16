import { describe, it, expect } from "vitest";
import { countRangesOverlap, dateWindowsOverlap, findSlabConflict, type SlabLike } from "./slab-validation";

describe("countRangesOverlap", () => {
  it("detects overlapping bounded ranges", () => {
    expect(countRangesOverlap(1, 50, 40, 100)).toBe(true);
  });

  it("detects non-overlapping bounded ranges", () => {
    expect(countRangesOverlap(1, 50, 51, 100)).toBe(false);
  });

  it("treats a null max as unbounded above", () => {
    expect(countRangesOverlap(1, null, 1000, 2000)).toBe(true);
  });
});

describe("dateWindowsOverlap", () => {
  it("detects overlapping windows", () => {
    expect(dateWindowsOverlap("2026-01-01", "2026-06-30", "2026-06-01", "2026-12-31")).toBe(true);
  });

  it("detects non-overlapping windows", () => {
    expect(dateWindowsOverlap("2026-01-01", "2026-03-31", "2026-04-01", "2026-06-30")).toBe(false);
  });

  it("treats a null 'from' as -infinity and null 'to' as +infinity", () => {
    expect(dateWindowsOverlap(null, null, "2099-01-01", null)).toBe(true);
  });
});

describe("findSlabConflict", () => {
  const base: SlabLike = { min_count: 1, max_count: 50, rate_pkr: 100 };

  it("returns null for a valid, non-conflicting slab", () => {
    expect(findSlabConflict(base, [])).toBeNull();
  });

  it("rejects min_count below 1", () => {
    expect(findSlabConflict({ ...base, min_count: 0 }, [])).toMatch(/Min must be/);
  });

  it("rejects a max_count below min_count", () => {
    expect(findSlabConflict({ ...base, min_count: 50, max_count: 10 }, [])).toMatch(/Max must be/);
  });

  it("rejects a negative rate", () => {
    expect(findSlabConflict({ ...base, rate_pkr: -1 }, [])).toMatch(/Rate must be/);
  });

  it("rejects effective_to before effective_from", () => {
    const candidate: SlabLike = { ...base, effective_from: "2026-06-01", effective_to: "2026-01-01" };
    expect(findSlabConflict(candidate, [])).toMatch(/'to' date must be on or after/);
  });

  it("flags an overlapping range for the same activation type", () => {
    const existing: SlabLike[] = [{ id: "a", min_count: 40, max_count: 100, rate_pkr: 200 }];
    const candidate: SlabLike = { ...base, min_count: 1, max_count: 50 };
    expect(findSlabConflict(candidate, existing)).toMatch(/Range overlaps/);
  });

  it("does not flag an overlapping range for a different activation type", () => {
    const existing: SlabLike[] = [{ id: "a", min_count: 40, max_count: 100, rate_pkr: 200, activation_type_id: "esim" }];
    const candidate: SlabLike = { ...base, min_count: 1, max_count: 50, activation_type_id: "physical" };
    expect(findSlabConflict(candidate, existing)).toBeNull();
  });

  it("excludes itself by id when editing an existing slab in place", () => {
    const existing: SlabLike[] = [{ id: "same-id", min_count: 1, max_count: 50, rate_pkr: 100 }];
    const candidate: SlabLike = { ...base, id: "same-id", rate_pkr: 150 }; // only the rate changed
    expect(findSlabConflict(candidate, existing)).toBeNull();
  });

  it("does not flag ranges in non-overlapping date windows even if counts overlap", () => {
    const existing: SlabLike[] = [
      { id: "a", min_count: 1, max_count: 50, rate_pkr: 100, effective_from: "2026-01-01", effective_to: "2026-06-30" },
    ];
    const candidate: SlabLike = { ...base, effective_from: "2026-07-01", effective_to: "2026-12-31" };
    expect(findSlabConflict(candidate, existing)).toBeNull();
  });
});
