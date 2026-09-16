import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tryTemplateExtraction } from "./template-extract";

// Real-shaped sample, matching what PaddleOCR actually returns for the
// client's order page (confirmed against a live upload — unlabeled order code
// first, "Order Placed on"'s date+time glued together with no separator,
// "Onic Number" not "Order Number").
//
// The CNIC pair was added after reviewing 35 real screenshots of this page:
// every one of them carries "CNIC number" and a 13-digit value, and the
// parser now treats it as required. See the "refuses a capture with no CNIC"
// test below for why that is deliberate rather than incidental.
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
  "CNIC number",
  "3820198722966",
].join("\n");

const lineOf = (sample: string, confidenceByText: Record<string, number> = {}, base = 0.97) =>
  sample.split("\n").map((text) => ({ text, confidence: confidenceByText[text] ?? base }));

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
      cnic: "3820198722966",
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
    // the isKnownLabel guard this bug (found and fixed earlier) would silently
    // set customer_name to the literal string "Onic Number".
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
    // And the base sample, which has neither, still matches.
    expect(tryTemplateExtraction(REAL_SAMPLE, 0.97)).not.toBeNull();
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

  // ── Required-field policy ──────────────────────────────────────────────────
  // Every one of the 35 reviewed screenshots carries all eight of these. A
  // capture missing one was cropped, so the AI should look at it rather than
  // this parser saving a half-empty row. An incomplete row that reports
  // "success" is worse than a failed one: nothing surfaces it, and it reaches
  // the client's database looking correct.
  describe("required fields", () => {
    it("refuses a capture with no CNIC rather than saving the row without it", () => {
      const noCnic = REAL_SAMPLE.split("\n").slice(0, -2).join("\n");
      expect(tryTemplateExtraction(noCnic, 0.97)).toBeNull();
    });

    it("refuses a capture whose timestamp line never came through", () => {
      const noTimestamp = REAL_SAMPLE.split("\n")
        .filter((l) => l !== "Order Placed on" && l !== "08 Aug202611:50 AM")
        .join("\n");
      expect(tryTemplateExtraction(noTimestamp, 0.97)).toBeNull();
    });

    it("requires current_network on a transfer order, but not on a new-number order", () => {
      const transfer = [
        "CXO-RAVKYRZ6RESYX8I",
        "Order Placed on",
        "15 Aug 2026 | 09:47 AM",
        "SIM type",
        "Physical SIM",
        "Number type",
        "Number transfer",
        "Current Number",
        "033 1770 6610",
        "Name",
        "Yasir Rehamn",
        "CNIC number",
        "3820184640883",
      ].join("\n");
      // No "Current Network" line -> refused, because a transfer always has one.
      expect(tryTemplateExtraction(transfer, 0.97)).toBeNull();

      const withNetwork = transfer.replace(
        "Name\nYasir Rehamn",
        "Current Network\nUfone\nName\nYasir Rehamn",
      );
      const result = tryTemplateExtraction(withNetwork, 0.97);
      expect(result!.data).toMatchObject({
        number_type: "Number transfer",
        phone_number: "033 1770 6610",
        current_network: "Ufone",
      });
    });
  });

  // ── Layout variants seen across the 35 screenshots ────────────────────────
  describe("layout variants", () => {
    it("reads a September order — the month is written 'Sept', not 'Sep'", () => {
      const sept = REAL_SAMPLE.replace("08 Aug202611:50 AM", "13 Sept 2026 | 01:44 PM");
      const result = tryTemplateExtraction(sept, 0.97);
      expect(result!.data).toMatchObject({
        activation_date: "13 Sept 2026",
        activation_time: "01:44 PM",
      });
    });

    it("finds the order code on a full-window capture, where line 0 is page chrome", () => {
      const fullWindow = ["Summary", "SIM Details", "Personal Details", "Order number", REAL_SAMPLE].join("\n");
      const result = tryTemplateExtraction(fullWindow, 0.97);
      expect(result!.data.order_number).toBe("CXO-2JDUW9NDWPXF6N3");
    });

    it("ignores trailing FAQ text and status-bar digits", () => {
      const noisy = ["80", "Summary", REAL_SAMPLE, "Commonly Asked Questions", "When will my order be ready for pickup at the self-pickup point?"].join("\n");
      const result = tryTemplateExtraction(noisy, 0.97);
      expect(result!.data).toMatchObject({
        order_number: "CXO-2JDUW9NDWPXF6N3",
        customer_name: "Adeel Zafar",
        cnic: "3820198722966",
      });
    });

    // Both confirmed from production. PaddleOCR emits one line per detected
    // text box, so whether the "13 Sept 2026 | 01:44 PM" row arrives as one
    // line or two depends on how wide a gap the "|" glyph opened in that
    // particular render. Handling only the glued form is what sent five rows
    // of a live 25-image batch to the AI.
    it("reads a timestamp split across two lines by the '|' separator", () => {
      const split = REAL_SAMPLE.replace("08 Aug202611:50 AM", ["09 Sept 2026", "04:28 PM"].join("\n"));
      const result = tryTemplateExtraction(split, 0.97);
      expect(result).not.toBeNull();
      expect(result!.data).toMatchObject({
        activation_date: "09 Sept 2026",
        activation_time: "04:28 PM",
      });
    });

    it("reads a split timestamp whose '|' survived on one side or the other", () => {
      const trailingPipe = REAL_SAMPLE.replace("08 Aug202611:50 AM", ["09 Sept 2026 |", "04:28 PM"].join("\n"));
      expect(tryTemplateExtraction(trailingPipe, 0.97)!.data).toMatchObject({
        activation_date: "09 Sept 2026",
        activation_time: "04:28 PM",
      });

      const leadingPipe = REAL_SAMPLE.replace("08 Aug202611:50 AM", ["09 Sept 2026", "| 04:28 PM"].join("\n"));
      expect(tryTemplateExtraction(leadingPipe, 0.97)!.data).toMatchObject({
        activation_date: "09 Sept 2026",
        activation_time: "04:28 PM",
      });
    });

    it("refuses when the date line came through but the time box was dropped", () => {
      const dateOnly = REAL_SAMPLE.replace("08 Aug202611:50 AM", "09 Sept 2026");
      expect(tryTemplateExtraction(dateOnly, 0.97)).toBeNull();
    });

    it("still matches the label when the pencil glyph is read as a stray character", () => {
      const withGlyphs = REAL_SAMPLE.replace("CNIC number", "CNIC number 2") + "\nAlternate Contact /\n03-001209900";
      const result = tryTemplateExtraction(withGlyphs, 0.97);
      expect(result!.data.cnic).toBe("3820198722966");
      expect(result!.data.alternative_contact).toBe("03-001209900");
    });
  });

  // ── Per-line confidence ───────────────────────────────────────────────────
  // The OCR service scores every line; readWithOcr now forwards those. Gating
  // each field on its own line's score, rather than on the page average, is
  // what stops one blurry line of page chrome from discarding a clean read.
  describe("per-line confidence", () => {
    it("refuses when a REQUIRED field's own line was read badly", () => {
      const lines = lineOf(REAL_SAMPLE, { "3820198722966": 0.55 });
      expect(tryTemplateExtraction(REAL_SAMPLE, 0.94, lines)).toBeNull();
    });

    it("keeps the row when only an OPTIONAL field's line was read badly, flagged low for review", () => {
      const sample = REAL_SAMPLE + "\nEmail\ncustomer@example.com";
      const lines = lineOf(sample, { "customer@example.com": 0.6 });
      const result = tryTemplateExtraction(sample, 0.94, lines);
      expect(result).not.toBeNull();
      expect(result!.data.email).toBe("customer@example.com");
      expect(result!.confidence.email).toBe(60); // caller turns <90 into needs_review
      expect(result!.confidence.cnic).toBe(97);
    });

    it("matches even when noisy page chrome drags the page average under the threshold", () => {
      const sample = ["80", "Summary", "Commonly Asked Questions", REAL_SAMPLE].join("\n");
      const lines = lineOf(sample, { "80": 0.31, Summary: 0.44, "Commonly Asked Questions": 0.4 });
      const pageAverage = lines.reduce((a, l) => a + l.confidence, 0) / lines.length;
      expect(pageAverage * 100).toBeLessThan(90); // the old page-average gate would have refused
      expect(tryTemplateExtraction(sample, pageAverage, lines)).not.toBeNull();
    });
  });
});
