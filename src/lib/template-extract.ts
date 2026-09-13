// Label-anchored fast path for the client's own rendered order page — always
// the same fixed layout/labels, only the values change (confirmed from real
// sample screenshots). Deterministic string matching over the already-clean
// OCR text, so it costs nothing and never talks to the AI. Falls back to null
// (→ caller uses the existing Gemini path unchanged) whenever it isn't
// confident this is that known layout — see the two gates below.
import type { ExtractField } from "@/lib/format";

export type TemplateExtractionResult = {
  data: Partial<Record<ExtractField, string | null>>;
  confidence: Record<string, number>;
} | null;

// These three must all be found for the result to be trusted at all — every
// real sample has them, and a row without a customer/phone/order number
// isn't worth saving regardless of which path produced it.
const CORE_FIELDS: ExtractField[] = ["order_number", "customer_name", "phone_number"];

// Order matters only in that the first matching pattern wins if a line could
// ambiguously match two — none currently do.
//
// order_number is deliberately NOT here: real OCR output (confirmed from a
// live sample) has no "Order Number" label line at all — the code is simply
// the first line, unlabeled. See ORDER_CODE_PATTERN below.
const LABEL_MAP: Array<{ pattern: RegExp; field: ExtractField }> = [
  { pattern: /^(onic|current)\s*(\/\s*onic)?\s*number$/i, field: "phone_number" },
  { pattern: /^name$/i, field: "customer_name" },
  { pattern: /^sim\s*type$/i, field: "sim_type" },
  { pattern: /^number\s*type$/i, field: "number_type" },
  { pattern: /^cnic\s*number$/i, field: "cnic" },
  { pattern: /^alternate\s*contact$/i, field: "alternative_contact" },
  { pattern: /^email$/i, field: "email" },
];

// The unlabeled first-line order code, e.g. "CXO-2JDUW9NDWPXF6N3" — a short
// run of letters, a hyphen, then the rest. If a real "Order Number" label
// ever does appear before it, LABEL_MAP would need an entry for it too; this
// pattern alone covers what's actually been observed.
const ORDER_CODE_PATTERN = /^[A-Z]{2,6}-[A-Z0-9-]{4,}$/i;

// Special-cased rather than in LABEL_MAP: one label's value splits into two
// fields. Real OCR output has no separator or even spacing between the parts
// ("08 Aug202611:50 AM", not "08 Aug 2026 | 11:50 AM" — PaddleOCR merges the
// thin "|" glyph into whitespace it then drops), so this pulls the date and
// time out positionally instead of splitting on a delimiter.
const ORDER_PLACED_PATTERN = /^order\s*placed\s*on$/i;
const ORDER_PLACED_VALUE_PATTERN = /^(\d{1,2}\s*[A-Za-z]{3})\s*(\d{4})\s*(\d{1,2}:\d{2}\s*[AP]M)$/i;

const DEFAULT_MIN_CONFIDENCE = 90;

// Guards against a missed OCR line between two labels (e.g. a blurred value):
// without this, "value" below would silently become the *next* label's text
// instead of the missing value, corrupting that field rather than leaving it
// blank.
function isKnownLabel(line: string): boolean {
  return ORDER_PLACED_PATTERN.test(line) || LABEL_MAP.some((m) => m.pattern.test(line));
}

/**
 * Returns parsed fields if (a) the OCR read was confident enough and (b) all
 * three core fields were found by exact label match — otherwise null, which
 * the caller treats as "not this layout, use Gemini." No partial merging
 * with the AI path in this version: a row is fully template or fully AI.
 */
export function tryTemplateExtraction(
  ocrText: string,
  ocrConfidence0to1: number,
): TemplateExtractionResult {
  const minConfidence = Number(process.env.TEMPLATE_MIN_CONFIDENCE) || DEFAULT_MIN_CONFIDENCE;
  const ocrConfidence = ocrConfidence0to1 * 100;
  if (!Number.isFinite(ocrConfidence) || ocrConfidence < minConfidence) return null;

  const lines = ocrText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const data: Partial<Record<ExtractField, string | null>> = {};

  // Unlabeled order code: only ever the very first line, so check it once
  // rather than inside the label-scanning loop below.
  if (lines[0] && ORDER_CODE_PATTERN.test(lines[0])) {
    data.order_number = lines[0];
  }

  for (let i = 0; i < lines.length - 1; i++) {
    const label = lines[i];
    const value = lines[i + 1];
    if (!value || isKnownLabel(value)) continue;

    if (ORDER_PLACED_PATTERN.test(label)) {
      const dateTimeMatch = ORDER_PLACED_VALUE_PATTERN.exec(value);
      if (dateTimeMatch) {
        data.activation_date ??= `${dateTimeMatch[1]} ${dateTimeMatch[2]}`;
        data.activation_time ??= dateTimeMatch[3];
      }
      continue;
    }

    const match = LABEL_MAP.find((m) => m.pattern.test(label));
    if (match && data[match.field] == null) {
      data[match.field] = value;
    }
  }

  const hasAllCoreFields = CORE_FIELDS.every((f) => {
    const v = data[f];
    return typeof v === "string" && v.length > 0;
  });
  if (!hasAllCoreFields) return null;

  // v1 keeps this simple: one confidence number (the OCR read's own overall
  // score) applied to every field found, rather than tracking per-line scores
  // through the OCR service's API. Good enough to drive needs_review the same
  // way the Gemini path already does.
  const confidence: Record<string, number> = {};
  const rounded = Math.round(ocrConfidence);
  for (const key of Object.keys(data)) confidence[key] = rounded;

  return { data, confidence };
}
