import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tryTemplateExtraction } from "./template-extract";

// Real-shaped sample, matching what PaddleOCR actually returns for the
// client's order page (confirmed against a live upload this session —
// unlabeled order code first, "Order Placed on"'s date+time glued together
// with no separator, "Onic Number" not "Order Number").
const REAL_SAMPLE = [
  "CXO-2JDUW9NDWPXF6N3",
  "Order Placed on",
  "08 Aug202611:50 AM",
  "Name",
  "Adeel Zafar",
  "Onic Number",
  "03399337788",
  "SIM type",
  "Physical SIM",
  "Number type",
  "New number",
].join("\n");

describe("tryTemplateExtraction", () => {
  const originalMinConfidence = process.env.TEMPLATE_MIN_CONFIDENCE;
  beforeEach(() => {
    delete process.env.TEMPLATE_MIN_CONFIDENCE; // use the 90 default unless a test overrides it
  });
  afterEach(() => {
    if (originalMinConfidence === undefined) delete process.env.TEMPLATE_MIN_CONFIDENCE;
    else process.env.TEMPLATE_MIN_CONFIDENCE = originalMinConfidence;
  });

  it("parses a full real-shaped sample, including the glued date+time split", () => {
    const result = tryTemplateExtraction(REAL_SAMPLE, 0.97);
    expect(result).not.toBeNull();
    expect(result!.data).toMatchObject({
      order_number: "CXO-2JDUW9NDWPXF6N3",
      customer_name: "Adeel Zafar",
      phone_number: "03399337788",
      sim_type: "Physical SIM",
      number_type: "New number",
      activation_date: "08 Aug 2026",
      activation_time: "11:50 AM",
    });
  });

  it("returns null when confidence is below the threshold", () => {
    expect(tryTemplateExtraction(REAL_SAMPLE, 0.5)).toBeNull();
  });

  it("respects TEMPLATE_MIN_CONFIDENCE when set", () => {
    process.env.TEMPLATE_MIN_CONFIDENCE = "40";
    expect(tryTemplateExtraction(REAL_SAMPLE, 0.5)).not.toBeNull();
  });

  it("returns null when a core field is missing (no phone number line at all)", () => {
    const missingPhone = [
      "CXO-2JDUW9NDWPXF6N3",
      "Name",
      "Adeel Zafar",
      "SIM type",
      "Physical SIM",
    ].join("\n");
    expect(tryTemplateExtraction(missingPhone, 0.97)).toBeNull();
  });

  it("returns null when the unlabeled order-code line is missing entirely", () => {
    const noOrderCode = REAL_SAMPLE.split("\n").slice(1).join("\n"); // drop line 0
    expect(tryTemplateExtraction(noOrderCode, 0.97)).toBeNull();
  });

  it("does not corrupt a field when the OCR line right after a label is missing (isKnownLabel guard)", () => {
    // "Name" is immediately followed by another label ("Onic Number") because
    // the actual name value line was dropped/blurred in this OCR pass. Without
    // the isKnownLabel guard this bug (found and fixed earlier this session)
    // would silently set customer_name to the literal string "Onic Number".
    const droppedNameValue = [
      "CXO-2JDUW9NDWPXF6N3",
      "Name",
      "Onic Number",
      "03399337788",
    ].join("\n");
    const result = tryTemplateExtraction(droppedNameValue, 0.97);
    // Core fields incomplete (customer_name never actually got set) -> null,
    // not a corrupted "Onic Number" value silently saved as the name.
    expect(result).toBeNull();
  });

  it("optional fields (alternate contact, email) are included when present but don't block a match when absent", () => {
    const withOptional = REAL_SAMPLE + "\nAlternate Contact\n03-473687403\nEmail\ncustomer@example.com";
    const result = tryTemplateExtraction(withOptional, 0.97);
    expect(result!.data.alternative_contact).toBe("03-473687403");
    expect(result!.data.email).toBe("customer@example.com");
  });

  it("returns null for OCR text from a completely different layout (no labels match at all)", () => {
    const unrelated = "Invoice #4471\nTotal: $58.00\nThank you for your purchase";
    expect(tryTemplateExtraction(unrelated, 0.99)).toBeNull();
  });

  it("every returned field carries the same rounded overall confidence", () => {
    const result = tryTemplateExtraction(REAL_SAMPLE, 0.955);
    expect(result).not.toBeNull();
    const values = Object.values(result!.confidence);
    expect(values.every((v) => v === 96)).toBe(true); // 95.5 rounds to 96
  });
});
