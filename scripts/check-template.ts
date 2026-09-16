/**
 * Runs the template parser against sample OCR output and prints what it got.
 *
 *   node scripts/check-template.ts
 *
 * No test runner and no dependencies: Node 22+ strips the types itself, and
 * template-extract.ts's only import is type-only, so nothing needs resolving.
 *
 * ── Read this before trusting a green run ────────────────────────────────────
 * The fixtures below are TRANSCRIPTIONS of what is visible on 35 real
 * screenshots, plus hand-written variants of the ways PaddleOCR is known to
 * mangle this page. They are NOT captured OCR output. They prove the parser
 * handles the layout and the known failure modes; they do not prove PaddleOCR
 * produces these exact lines on the VPS.
 *
 * To close that gap, replace a fixture's `text` with real output from:
 *
 *   docker exec orderscan-ocr python -c "from app.preprocess import preprocess; import numpy as np; from paddleocr import PaddleOCR; e=PaddleOCR(use_angle_cls=True,lang='en',show_log=False,det_limit_side_len=960,rec_batch_num=6,cpu_threads=2); r=e.ocr(np.asarray(preprocess(open('/tmp/test.png','rb').read())),cls=True); [print(l[1][0]) for l in r[0]]"
 *
 * and re-run. A fixture that still passes on real output is a fixture you can
 * rely on.
 */
import { tryTemplateExtraction } from "../src/lib/template-extract.ts";

type Expect = Record<string, string | null>;
type Case = {
  name: string;
  text: string;
  /** null = the parser must refuse this input and hand it to the AI. */
  expect: Expect | null;
};

const cases: Case[] = [
  // ── Straight reads, one per observed variant ──────────────────────────────
  {
    name: "new number, label present",
    text: `Order number
CXO-4CISTI1BFTJ3HR3
Order Placed on
13 Sept 2026 | 01:44 PM
SIM type
Physical SIM
Number type
New number
Onic Number
033 9139 5408
Name
Hajra Batool
CNIC number
3820198722966`,
    expect: {
      order_number: "CXO-4CISTI1BFTJ3HR3",
      activation_date: "13 Sept 2026",
      activation_time: "01:44 PM",
      sim_type: "Physical SIM",
      number_type: "New number",
      phone_number: "033 9139 5408",
      customer_name: "Hajra Batool",
      cnic: "3820198722966",
    },
  },
  {
    name: "top cropped — no 'Order number' label at all",
    text: `CXO-MDYGXTV3CHV1FMT
Order Placed on
08 Aug 2026 | 04:35 PM
SIM type
Physical SIM
Number type
New number
Onic Number
033 9749 7057
Name
M Kamran
CNIC number
3820115104753`,
    expect: {
      order_number: "CXO-MDYGXTV3CHV1FMT",
      activation_date: "08 Aug 2026",
      activation_time: "04:35 PM",
      number_type: "New number",
      phone_number: "033 9749 7057",
      customer_name: "M Kamran",
      cnic: "3820115104753",
    },
  },
  {
    name: "number transfer — Current Number + Current Network",
    text: `CXO-RAVKYRZ6RESYX8I
Order Placed on
15 Aug 2026 | 09:47 AM
SIM type
Physical SIM
Number type
Number transfer
Current Number
033 1770 6610
Current Network
Ufone
Name
Yasir Rehamn
CNIC number
3820184640883`,
    expect: {
      order_number: "CXO-RAVKYRZ6RESYX8I",
      number_type: "Number transfer",
      phone_number: "033 1770 6610",
      current_network: "Ufone",
      customer_name: "Yasir Rehamn",
      cnic: "3820184640883",
      activation_time: "09:47 AM",
    },
  },
  {
    name: "eSIM with alternate contact and email",
    text: `CXO-TIEDPIHRJD19P7D
Order Placed on
15 Aug 2026 | 12:40 PM
SIM type
eSIM
Number type
New number
Onic Number
033 9670 0220
Name
Arshad Mehmood
CNIC number
3820199475137
Alternate Contact
03-026700220
Email
arshadmehram32@gmail.com`,
    expect: {
      order_number: "CXO-TIEDPIHRJD19P7D",
      sim_type: "eSIM",
      phone_number: "033 9670 0220",
      customer_name: "Arshad Mehmood",
      cnic: "3820199475137",
      alternative_contact: "03-026700220",
      email: "arshadmehram32@gmail.com",
    },
  },
  {
    name: "transfer on Jazz",
    text: `CXO-QJZ76P3PYBHXNQH
Order Placed on
02 Sept 2026 | 01:57 PM
SIM type
Physical SIM
Number type
Number transfer
Current Number
030 0259 0069
Current Network
Jazz
Name
M Javed
CNIC number
3820107785037`,
    expect: {
      order_number: "CXO-QJZ76P3PYBHXNQH",
      current_network: "Jazz",
      phone_number: "030 0259 0069",
      customer_name: "M Javed",
      activation_date: "02 Sept 2026",
    },
  },

  // ── Page chrome from full-window captures ────────────────────────────────
  {
    name: "full window — Summary / tab chrome before the order code",
    text: `Summary
SIM Details
Personal Details
Order number
CXO-MEYAYXSRIFXUK2Y
Order Placed on
11 Aug 2026 | 10:53 AM
SIM type
Physical SIM
Number type
New number
Onic Number
033 9435 6609
Name
M Waheeb
CNIC number
3820116978569
Registered Number
03-394356609`,
    expect: {
      order_number: "CXO-MEYAYXSRIFXUK2Y",
      customer_name: "M Waheeb",
      cnic: "3820116978569",
      phone_number: "033 9435 6609",
      // "Registered Number" is not mapped — see the note at the bottom of this
      // file. It must not leak into alternative_contact.
      alternative_contact: null,
    },
  },
  {
    name: "full window — status bar digits and trailing FAQ text",
    text: `80
Summary
CXO-7M85EAL7VOJCRUK
Order Placed on
31 Aug 2026 | 11:32 AM
SIM type
Physical SIM
Number type
New number
Onic Number
033 9530 0171
Name
Muhammad Shafi
CNIC number
3820168376395
Commonly Asked Questions
When will my order be ready for pickup at the self-pickup point?`,
    expect: {
      order_number: "CXO-7M85EAL7VOJCRUK",
      customer_name: "Muhammad Shafi",
      cnic: "3820168376395",
      activation_time: "11:32 AM",
    },
  },

  // ── Known PaddleOCR mangling ─────────────────────────────────────────────
  {
    name: "merged timestamp — the '|' glyph dropped, spacing lost",
    text: `CXO-ZXTOTS134W4DROO
Order Placed on
15 Aug 202605:43 PM
SIM type
eSIM
Number type
New number
Onic Number
033 9847 1804
Name
Zain Ali
CNIC number
3820122189707`,
    expect: {
      activation_date: "15 Aug 2026",
      activation_time: "05:43 PM",
      order_number: "CXO-ZXTOTS134W4DROO",
      customer_name: "Zain Ali",
    },
  },
  {
    name: "pencil glyph read as a stray character after the label",
    text: `CXO-LA3ZEH3ZIWWTHBQ
Order Placed on
08 Sept 2026 | 02:12 PM
SIM type
eSIM
Number type
New number
Onic Number
033 9469 9000
Name
Ahmad Bilal
CNIC number 2
3820189664583
Alternate Contact /
03-001209900
Email
ahmadbilalahir@gmail.com`,
    expect: {
      cnic: "3820189664583",
      alternative_contact: "03-001209900",
      email: "ahmadbilalahir@gmail.com",
      order_number: "CXO-LA3ZEH3ZIWWTHBQ",
    },
  },
  {
    name: "September written 'Sept' — the four-letter month",
    text: `Order number
CXO-8PEG3KQOAD6W0YJ
Order Placed on
02 Sept 2026 | 01:12 PM
SIM type
Physical SIM
Number type
New number
Onic Number
033 9067 4965
Name
M Hussain
CNIC number
3820111479269`,
    expect: { activation_date: "02 Sept 2026", activation_time: "01:12 PM" },
  },
  {
    name: "order-number label garbled by the crop — code still found by scan",
    text: `Oruer numuer
CXO-IYE2FF8R24HTVCZ
Order Placed on
20 Aug 2026 | 04:33 PM
SIM type
Physical SIM
Number type
New number
Onic Number
033 9203 0439
Name
M Munavar
CNIC number
3820199379903`,
    expect: { order_number: "CXO-IYE2FF8R24HTVCZ", customer_name: "M Munavar" },
  },

  // ── Must refuse ──────────────────────────────────────────────────────────
  {
    name: "REFUSE: cropped before the CNIC — required field missing",
    text: `Order number
CXO-4CISTI1BFTJ3HR3
Order Placed on
13 Sept 2026 | 01:44 PM
SIM type
Physical SIM
Number type
New number
Onic Number
033 9139 5408
Name
Hajra Batool`,
    expect: null,
  },
  {
    name: "REFUSE: transfer order whose Current Network line was cut",
    text: `CXO-RAVKYRZ6RESYX8I
Order Placed on
15 Aug 2026 | 09:47 AM
SIM type
Physical SIM
Number type
Number transfer
Current Number
033 1770 6610
Name
Yasir Rehamn
CNIC number
3820184640883`,
    expect: null,
  },
  {
    name: "REFUSE: a different document entirely",
    text: `WhatsApp
Ali Traders
Order for 2 sims
Payment done 5000
Thanks`,
    expect: null,
  },
  {
    name: "REFUSE: missing timestamp",
    text: `Order number
CXO-P9ZN6CICZYNHK0Y
SIM type
Physical SIM
Number type
New number
Onic Number
033 9641 6076
Name
Abdual Rehman
CNIC number
3820178294905`,
    expect: null,
  },
];

// Per-line confidence cases: same layout, but one line read badly. A weak
// REQUIRED field must sink the row; a weak OPTIONAL field must not.
const confidenceCases: Array<{ name: string; lines: Array<[string, number]>; shouldMatch: boolean }> = [
  {
    name: "weak REQUIRED line (CNIC at 0.55) → refuse",
    shouldMatch: false,
    lines: [
      ["CXO-5LCSYTC9SQ8PWKT", 0.99], ["Order Placed on", 0.99], ["09 Sept 2026 | 04:28 PM", 0.98],
      ["SIM type", 0.99], ["Physical SIM", 0.99], ["Number type", 0.99], ["New number", 0.99],
      ["Onic Number", 0.99], ["033 9607 4126", 0.98], ["Name", 0.99], ["M Adnan", 0.97],
      ["CNIC number", 0.99], ["3820140451451", 0.55],
    ],
  },
  {
    name: "weak OPTIONAL line (email at 0.60) → still match, flagged low",
    shouldMatch: true,
    lines: [
      ["CXO-MEYEP53SZ5LD78N", 0.99], ["Order Placed on", 0.99], ["08 Sept 2026 | 01:45 PM", 0.98],
      ["SIM type", 0.99], ["eSIM", 0.99], ["Number type", 0.99], ["New number", 0.99],
      ["Onic Number", 0.99], ["033 9098 0966", 0.98], ["Name", 0.99], ["Muhammad Sohaib", 0.97],
      ["CNIC number", 0.99], ["3820139858455", 0.96],
      ["Alternate Contact", 0.99], ["03-220980966", 0.95],
      ["Email", 0.99], ["msohaib20@gmail.com", 0.60],
    ],
  },
  {
    name: "noisy chrome drags the PAGE average down, fields still clean → match",
    shouldMatch: true,
    lines: [
      ["80", 0.31], ["Summary", 0.44], ["Commonly Asked Questions", 0.40],
      ["CXO-B686383PGHK9YQG", 0.99], ["Order Placed on", 0.99], ["12 Sept 2026 | 04:34 PM", 0.98],
      ["SIM type", 0.99], ["Physical SIM", 0.99], ["Number type", 0.99], ["New number", 0.99],
      ["Onic Number", 0.99], ["033 9844 6565", 0.98], ["Name", 0.99], ["Nadia Mukhtar", 0.97],
      ["CNIC number", 0.99], ["3820134885290", 0.96],
    ],
  },
];

let passed = 0;
let failed = 0;

console.log("\n=== layout cases ===\n");
for (const c of cases) {
  const got = tryTemplateExtraction(c.text, 0.97);

  if (c.expect === null) {
    if (got === null) {
      console.log(`  PASS  ${c.name}`);
      passed++;
    } else {
      console.log(`  FAIL  ${c.name}`);
      console.log(`        expected refusal, got: ${JSON.stringify(got.data)}`);
      failed++;
    }
    continue;
  }

  if (got === null) {
    console.log(`  FAIL  ${c.name}`);
    console.log(`        expected a match, got refusal`);
    failed++;
    continue;
  }

  const wrong: string[] = [];
  for (const [field, want] of Object.entries(c.expect)) {
    const have = (got.data as Record<string, string | null | undefined>)[field] ?? null;
    if (have !== want) wrong.push(`${field}: want ${JSON.stringify(want)}, got ${JSON.stringify(have)}`);
  }

  if (wrong.length === 0) {
    console.log(`  PASS  ${c.name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${c.name}`);
    for (const w of wrong) console.log(`        ${w}`);
    failed++;
  }
}

console.log("\n=== per-line confidence cases ===\n");
for (const c of confidenceCases) {
  const lines = c.lines.map(([text, confidence]) => ({ text, confidence }));
  const text = lines.map((l) => l.text).join("\n");
  const pageAvg = lines.reduce((a, l) => a + l.confidence, 0) / lines.length;
  const got = tryTemplateExtraction(text, pageAvg, lines);
  const matched = got !== null;

  if (matched === c.shouldMatch) {
    const detail = got ? ` (min score ${Math.min(...Object.values(got.confidence))})` : "";
    console.log(`  PASS  ${c.name}${detail}`);
    passed++;
  } else {
    console.log(`  FAIL  ${c.name} — expected ${c.shouldMatch ? "match" : "refusal"}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);

if (failed > 0) process.exitCode = 1;

/*
 * Open question left deliberately unresolved, for a human to decide:
 *
 * "Registered Number" appeared on one of the 35 samples, in the slot where
 * "Alternate Contact" normally sits — and its value was the SAME number as the
 * order's own Onic Number (033 9435 6609 vs 03-394356609). It is therefore not
 * an alternate contact, and mapping it to one would write a duplicate of the
 * phone number into a different field. It is left unmapped until someone
 * confirms what that label means on the source page.
 *
 * Separately: `alternative_contact` has NO COLUMN on the `extractions` table
 * (confirmed against src/integrations/supabase/types.ts). Every row that
 * extracts it pays a rejected UPDATE plus the retry in
 * extract-core.server.ts:427. Either add the column or drop the field.
 */
