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
const LABEL_MAP: Array<{ pattern: RegExp; field: ExtractField }> = [
  { pattern: /^order\s*number$/i, field: "order_number" },
  { pattern: /^(onic|current)\s*(\/\s*onic)?\s*number$/i, field: "phone_number" },
  { pattern: /^name$/i, field: "customer_name" },
  { pattern: /^sim\s*type$/i, field: "sim_type" },
  { pattern: /^number\s*type$/i, field: "number_type" },
  { pattern: /^cnic\s*number$/i, field: "cnic" },
  { pattern: /^alternate\s*contact$/i, field: "alternative_contact" },
  { pattern: /^email$/i, field: "email" },
];

// Special-cased rather than in LABEL_MAP: one label's value splits into two
// fields ("08 Aug 2026 | 11:50 AM" -> activation_date + activation_time).
const ORDER_PLACED_PATTERN = /^order\s*placed\s*on$/i;

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

  for (let i = 0; i < lines.length - 1; i++) {
    const label = lines[i];
    const value = lines[i + 1];
    if (!value || isKnownLabel(value)) continue;

    if (ORDER_PLACED_PATTERN.test(label)) {
      const [datePart, timePart] = value.split("|").map((s) => s.trim());
      if (datePart) data.activation_date ??= datePart;
      if (timePart) data.activation_time ??= timePart;
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
