// Label-anchored fast path for the client's own rendered order page — always
// the same fixed layout/labels, only the values change. Deterministic string
// matching over the OCR text, so it costs nothing and never talks to the AI.
// Falls back to null (→ caller uses the AI path unchanged) whenever it isn't
// confident this is that known layout — see the gates below.
//
// Built against 35 real screenshots of the "Summary" page. What those samples
// established, and what this file therefore has to handle:
//
//   - The page has TWO cards. The first ("SIM Details") carries the order
//     code, the placement timestamp, SIM type, number type and the phone
//     number. The second carries name, CNIC, and optionally an alternate
//     contact and email.
//   - `Number type` decides which phone label appears: "New number" orders are
//     labelled "Onic Number"; "Number transfer" orders are labelled "Current
//     Number" AND additionally carry "Current Network".
//   - Captures are frequently cropped at the top, so the "Order number" label
//     is often missing and the code is the first visible line — but on a
//     full-window capture it is NOT first, because "Summary" / "SIM Details" /
//     "Personal Details" chrome precedes it.
//   - Months are written "Sept", not "Sep" (6 of the 35 samples). A month
//     pattern fixed at three letters fails silently on every September order.
//   - `CNIC number` and `Alternate Contact` carry a small pencil glyph beside
//     the label.
import type { ExtractField } from "@/lib/format";

/** One OCR line and the score the OCR service gave it. */
export type TemplateLine = { text: string; confidence: number };

export type TemplateExtractionResult = {
  data: Partial<Record<ExtractField, string | null>>;
  confidence: Record<string, number>;
} | null;

// Present on all 35 sample screenshots without exception. A capture missing
// any of these was cropped, or is not this page — either way the AI should
// look at it rather than this parser saving a half-empty row as "success".
// An incomplete row that succeeds is worse than a failed one: nothing
// surfaces it, and it reaches the client's database looking correct.
const REQUIRED_FIELDS: ExtractField[] = [
  "order_number",
  "customer_name",
  "phone_number",
  "cnic",
  "sim_type",
  "number_type",
  "activation_date",
  "activation_time",
];

// Required only on "Number transfer" orders — a "New number" order has no
// previous network and correctly has no such line.
const TRANSFER_REQUIRED_FIELDS: ExtractField[] = ["current_network"];
const TRANSFER_NUMBER_TYPE = /transfer/i;

// Some labels carry a pencil/edit glyph ("CNIC number [pencil]"). Depending on
// the capture PaddleOCR drops it, merges it into the label, or emits one or
// two stray characters. Allowing a short trailing artifact matches all three
// cases; bounding it at two characters stops an unrelated line from matching.
const ICON = String.raw`(?:\s*\S{1,2})?`;

type LabelRule = {
  pattern: RegExp;
  field: ExtractField;
  /** Rejects a value that matched by position but is not plausible content. */
  validate?: (value: string) => boolean;
};

// The order code, e.g. "CXO-4CISTI1BFTJ3HR3": a short run of letters, a
// hyphen, then 6-24 alphanumerics. Bounded on the right so a long line that
// happens to contain a hyphen cannot be mistaken for a code.
//
// Matched against the line with its whitespace stripped. These codes are a
// long run of ambiguous glyphs and PaddleOCR readily drops a space into the
// middle of one ("CXO-5ETGM9 MFIU7AQNC"), which an unforgiving whole-line
// match rejects outright — and losing the order code loses the whole row,
// since it is the field the fallback scan and the required-set both hang on.
// Stripping spaces cannot create a false positive: the shape still has to be
// letters, one hyphen, then alphanumerics.
const ORDER_CODE_PATTERN = /^[A-Z]{2,6}-[A-Z0-9-]{6,24}$/i;

function asOrderCode(line: string): string | null {
  const compact = line.replace(/\s+/g, "");
  return ORDER_CODE_PATTERN.test(compact) ? compact : null;
}

// The code embedded in a longer line, e.g. when the detector merged the label
// and its value into one box ("Order number CXO-4CISTI1BFTJ3HR3").
//
// Substring matching needs a tighter shape than the whole-line form, because
// ordinary hyphenated English matches the bare pattern — "Self-pickup" is
// four letters, a hyphen and six alphanumerics. The tail must therefore
// contain a digit: all 35 sampled codes do, and hyphenated words do not.
const EMBEDDED_ORDER_CODE = /\b([A-Z]{2,6}-[A-Z0-9]{6,24})\b/i;

// The code split across two detected boxes, leaving a dangling prefix on one
// line and the rest on the next ("CXO-" / "4CISTI1BFTJ3HR3"). Same split the
// "|" in the timestamp causes, for the same reason.
const DANGLING_PREFIX = /^[A-Z]{2,6}-$/i;
const CODE_TAIL = /^[A-Z0-9]{6,24}$/i;

function hasDigit(s: string): boolean {
  return /\d/.test(s);
}

/** Finds the order code across every shape OCR has been seen to produce. */
function findOrderCode(rows: TemplateLine[]): { code: string; lineIndex: number } | null {
  // 1. A line that is nothing but the code.
  for (let i = 0; i < rows.length; i++) {
    const code = asOrderCode(rows[i].text);
    if (code) return { code, lineIndex: i };
  }

  // 2. Split across two consecutive lines.
  for (let i = 0; i < rows.length - 1; i++) {
    const head = rows[i].text.replace(/\s+/g, "");
    const tail = rows[i + 1].text.replace(/\s+/g, "");
    if (DANGLING_PREFIX.test(head) && CODE_TAIL.test(tail) && hasDigit(tail)) {
      return { code: head + tail, lineIndex: i + 1 };
    }
  }

  // 3. Embedded in a longer line, most likely merged with its own label.
  for (let i = 0; i < rows.length; i++) {
    const m = EMBEDDED_ORDER_CODE.exec(rows[i].text.replace(/\s+/g, " "));
    if (m && hasDigit(m[1])) return { code: m[1], lineIndex: i };
  }

  return null;
}

// Order matters only where two patterns could match one line — none currently do.
const LABEL_MAP: LabelRule[] = [
  {
    pattern: /^order\s*number$/i,
    field: "order_number",
    validate: (v) => asOrderCode(v) !== null,
  },
  // "Onic Number" on new-number orders, "Current Number" on transfers.
  { pattern: /^(onic|current)\s*(\/\s*onic)?\s*number$/i, field: "phone_number" },
  { pattern: /^current\s*network$/i, field: "current_network" },
  { pattern: /^name$/i, field: "customer_name" },
  { pattern: /^sim\s*type$/i, field: "sim_type" },
  { pattern: /^number\s*type$/i, field: "number_type" },
  { pattern: new RegExp(String.raw`^cnic\s*number${ICON}$`, "i"), field: "cnic" },
  {
    pattern: new RegExp(String.raw`^alternate\s*contact${ICON}$`, "i"),
    field: "alternative_contact",
  },
  { pattern: /^email$/i, field: "email" },
];

// Page chrome that appears on full-window captures. Listed so it can never be
// mistaken for a label's value — the guard below treats these exactly like a
// label, i.e. "this is not a value, the real one is missing".
const NOISE_PATTERNS: RegExp[] = [
  /^summary$/i,
  /^sim\s*details$/i,
  /^personal\s*details$/i,
  /^commonly\s*asked\s*questions$/i,
  /^when\s+will\s+my\s+order/i,
  /^pickup\s*point/i,
  // Status-bar digits and lone glyphs (back arrow, avatar icon) that OCR
  // sometimes emits as their own line.
  /^\d{1,3}$/,
  /^[^A-Za-z0-9]{1,3}$/,
];

// The timestamp label's value splits into two fields, and the "|" separator
// behaves in two different ways depending on the render — BOTH confirmed from
// production rows:
//
//   one line   "13 Sept 202601:44 PM"   PaddleOCR detected the whole timestamp
//                                       as a single text box and dropped the
//                                       thin "|" glyph along with the spacing.
//   two lines  "09 Sept 2026"           The "|" opened a wide enough gap that
//              "04:28 PM"               the detector split it into two boxes,
//                                       and main.py emits one line per box.
//
// Handling only the first shape is what sent five rows of a live 25-image
// batch to the AI: their timestamps came through split, the parser saw a
// date-only line that matched nothing, and the whole row was refused for
// missing activation_date/activation_time. Groq then charged nothing but also
// returned null for both, which is how the split was spotted at all.
//
// The month is 3-9 letters, NOT 3: this page writes "Sept".
const ORDER_PLACED_PATTERN = /^order\s*placed\s*on$/i;
const ORDER_PLACED_VALUE_PATTERN =
  /^(\d{1,2})\s*([A-Za-z]{3,9})\.?\s*(\d{4})\s*\|?\s*(\d{1,2}:\d{2})\s*([AP]\.?M\.?)$/i;
const DATE_ONLY_PATTERN = /^(\d{1,2})\s*([A-Za-z]{3,9})\.?\s*(\d{4})\s*\|?$/i;
const TIME_ONLY_PATTERN = /^\|?\s*(\d{1,2}:\d{2})\s*([AP]\.?M\.?)$/i;

function normaliseTime(hhmm: string, meridiem: string): string {
  return `${hhmm} ${meridiem.toUpperCase().replace(/\./g, "")}`;
}

const DEFAULT_MIN_CONFIDENCE = 90;

function isNoise(line: string): boolean {
  return NOISE_PATTERNS.some((p) => p.test(line));
}

// Guards against a missed OCR line between a label and its value (e.g. a
// blurred value the detector dropped): without this, the *next* label's text
// silently becomes this field's value, corrupting that field rather than
// leaving it blank.
function isKnownLabel(line: string): boolean {
  return ORDER_PLACED_PATTERN.test(line) || LABEL_MAP.some((m) => m.pattern.test(line));
}

function isUsableValue(line: string): boolean {
  return line.length > 0 && !isKnownLabel(line) && !isNoise(line);
}

/**
 * Parses this one known layout out of OCR output.
 *
 * Returns null — meaning "not this layout, use the AI" — unless every required
 * field was found by label match AND the lines those fields came from were read
 * confidently. Optional fields (alternate contact, email) are kept at their
 * real confidence rather than gating the row, so a blurry optional line flags
 * the row for review through the caller's existing `needs_review` rule instead
 * of throwing the whole read away.
 *
 * `lines` is optional. When the caller passes the OCR service's per-line
 * scores, each field is gated on the confidence of the line it actually came
 * from. Without it every line is assumed to carry the page average, which is
 * strictly worse: one blurry line of page chrome (an FAQ heading, a status
 * bar) drags the average down and rejects a page whose fields were read
 * perfectly.
 */
export function tryTemplateExtraction(
  ocrText: string,
  ocrConfidence0to1: number,
  lines?: TemplateLine[],
): TemplateExtractionResult {
  const minConfidence = Number(process.env.TEMPLATE_MIN_CONFIDENCE) || DEFAULT_MIN_CONFIDENCE;
  const pageConfidence = ocrConfidence0to1 * 100;
  if (!Number.isFinite(pageConfidence)) return null;

  const havePerLine = Boolean(lines?.length);
  const rows: TemplateLine[] = (
    havePerLine
      ? lines!.map((l) => ({
          text: (l.text ?? "").trim(),
          confidence: (l.confidence ?? 0) * 100,
        }))
      : ocrText.split("\n").map((text) => ({ text: text.trim(), confidence: pageConfidence }))
  ).filter((l) => l.text.length > 0);

  // Without per-line scores there is nothing finer to gate on than the page
  // average, so apply it up front exactly as this used to.
  if (!havePerLine && pageConfidence < minConfidence) return null;

  const data: Partial<Record<ExtractField, string | null>> = {};
  // Which line each field's value came from, so its score can be read back.
  const sourceLine: Partial<Record<ExtractField, number>> = {};

  const assign = (field: ExtractField, value: string, lineIndex: number) => {
    if (data[field] != null) return;
    data[field] = value;
    sourceLine[field] = lineIndex;
  };

  for (let i = 0; i < rows.length - 1; i++) {
    const label = rows[i].text;
    const value = rows[i + 1].text;
    if (!isUsableValue(value)) continue;

    if (ORDER_PLACED_PATTERN.test(label)) {
      const whole = ORDER_PLACED_VALUE_PATTERN.exec(value);
      if (whole) {
        assign("activation_date", `${whole[1]} ${whole[2]} ${whole[3]}`, i + 1);
        assign("activation_time", normaliseTime(whole[4], whole[5]), i + 1);
        continue;
      }

      // Split across two boxes: the date line, then the time on the next one.
      const dateOnly = DATE_ONLY_PATTERN.exec(value);
      if (dateOnly) {
        assign("activation_date", `${dateOnly[1]} ${dateOnly[2]} ${dateOnly[3]}`, i + 1);
        const next = rows[i + 2]?.text;
        const timeOnly = next ? TIME_ONLY_PATTERN.exec(next) : null;
        if (timeOnly) assign("activation_time", normaliseTime(timeOnly[1], timeOnly[2]), i + 2);
      }
      continue;
    }

    const rule = LABEL_MAP.find((r) => r.pattern.test(label));
    if (rule && (!rule.validate || rule.validate(value))) {
      assign(rule.field, value, i + 1);
    }
  }

  // Fallback for the common cropped capture, where the "Order number" label was
  // cut off and the code is simply the first visible line. Scanning for the
  // pattern rather than reading line 0 blindly is deliberate: on a full-window
  // capture line 0 is "Summary", so reading line 0 as the code found nothing
  // and the row fell through to the AI every time.
  if (data.order_number == null) {
    const found = findOrderCode(rows);
    if (found) assign("order_number", found.code, found.lineIndex);
  }

  const required = [...REQUIRED_FIELDS];
  if (TRANSFER_NUMBER_TYPE.test(String(data.number_type ?? ""))) {
    required.push(...TRANSFER_REQUIRED_FIELDS);
  }

  const missing = required.filter((f) => {
    const v = data[f];
    return typeof v !== "string" || v.length === 0;
  });
  if (missing.length > 0) {
    // A near miss is the interesting case and used to be completely silent:
    // the row simply went to the AI with nothing said about why.
    //
    // The first version of this log only fired when an order code had been
    // found, which turned out to hide exactly the case that needed
    // explaining — a batch left four rows on the AI path and produced no
    // refusal lines at all, because whatever went wrong took the order code
    // with it. Firing on two matched labels instead covers "this is clearly
    // the layout but the code did not survive", while still staying quiet on
    // unrelated documents, which match nothing.
    const found = Object.keys(data);
    if (found.length >= 2) {
      // When the order code specifically is what went missing, show the top of
      // the page too. That is where the code lives, it is the one part of this
      // layout carrying no personal data, and without it a missing code is
      // only diagnosable by re-running the image through OCR by hand.
      const head =
        data.order_number == null
          ? ` | first lines: ${rows.slice(0, 3).map((r) => JSON.stringify(r.text)).join(" ")}`
          : "";
      console.log(
        `[template] refused ${data.order_number ?? "(no order code)"} — missing: ${missing.join(", ")} | found: ${found.join(", ")}${head}`,
      );
    }
    return null;
  }

  const confidence: Record<string, number> = {};
  for (const key of Object.keys(data) as ExtractField[]) {
    const idx = sourceLine[key];
    const score = idx != null && rows[idx] ? rows[idx].confidence : pageConfidence;
    confidence[key] = Math.round(score);
  }

  // Every required field must have been read confidently. Optional ones keep
  // whatever they scored — the caller turns anything under 90 into
  // needs_review, which is the right outcome for a blurry email.
  const weakRequired = required.find((f) => (confidence[f] ?? 0) < minConfidence);
  if (weakRequired) return null;

  return { data, confidence };
}
