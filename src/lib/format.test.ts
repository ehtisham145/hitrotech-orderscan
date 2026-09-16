import { describe, it, expect } from "vitest";
import { normalizePhone, normalizeCnic, avgConfidence } from "./format";

describe("normalizePhone", () => {
  it("passes through an already-correct 03xx number", () => {
    expect(normalizePhone("03001234567")).toBe("03001234567");
  });

  it("converts +92 country code to a leading 0", () => {
    expect(normalizePhone("+923001234567")).toBe("03001234567");
  });

  it("converts bare 92 country code to a leading 0", () => {
    expect(normalizePhone("923001234567")).toBe("03001234567");
  });

  it("adds a missing leading 0 on a 10-digit 3xx number", () => {
    expect(normalizePhone("3001234567")).toBe("03001234567");
  });

  it("strips non-digit separators (dashes, spaces)", () => {
    expect(normalizePhone("0300-123 4567")).toBe("03001234567");
  });

  it("returns null for null/undefined/empty input", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("leaves an unrecognized shape as-is (digits/+ only, no guessing)", () => {
    expect(normalizePhone("021-111222333")).toBe("021111222333");
  });
});

describe("normalizeCnic", () => {
  it("formats 13 raw digits into XXXXX-XXXXXXX-X", () => {
    expect(normalizeCnic("3520212345671")).toBe("35202-1234567-1");
  });

  it("re-formats an already-dashed CNIC the same way", () => {
    expect(normalizeCnic("35202-1234567-1")).toBe("35202-1234567-1");
  });

  it("returns the trimmed input unchanged when not 13 digits", () => {
    expect(normalizeCnic("12345")).toBe("12345");
  });

  it("returns null for null/undefined/empty input", () => {
    expect(normalizeCnic(null)).toBeNull();
    expect(normalizeCnic(undefined)).toBeNull();
    expect(normalizeCnic("")).toBeNull();
  });
});

describe("avgConfidence", () => {
  it("averages numeric confidence values", () => {
    expect(avgConfidence({ a: 80, b: 100 })).toBe(90);
  });

  it("ignores non-numeric values mixed into the record", () => {
    expect(avgConfidence({ a: 80, b: "n/a" as unknown as number })).toBe(80);
  });

  it("returns 0 for null/undefined/empty input", () => {
    expect(avgConfidence(null)).toBe(0);
    expect(avgConfidence(undefined)).toBe(0);
    expect(avgConfidence({})).toBe(0);
  });
});
