# HitroTech OrderScan — working notes

Upload order/receipt screenshots, read the fields out of them, store them in
Supabase. Admin panel and partner portal are the same app.

This file is the context an incoming session needs that the code does not say on
its own — the constraints, the traps, and the things that have already been
measured so they don't get re-derived.

---

## 1. Shape of the system

```
[browser] user picks files
   │  import-processing.ts expands them BEFORE anything is uploaded:
   │  ZIP → members, PDF → one PNG per page, HEIC → JPG, then every
   │  image is canvas-resized to ≤1200×1600 JPEG q0.8
   │
   ├──upload──> Supabase Storage (bucket: screenshots)
   │            one `extractions` row per file, status = pending
   │
   └──"process this row"──> app server (VPS)   ← driven by 4 browser workers
                                 │
                                 ├─ claim row  (pending|failed → processing)
                                 ├─ download screenshot
                                 ├─ OCR service ──> text        (primary)
                                 │     └─ busy/down? text is null, never a failure
                                 │
                                 ├─ template-extract.ts ─ match? ─> skip the AI
                                 │     (DISABLED by default — shadow-logs only)
                                 │
                                 ├─ have text? ─yes─> Groq (free, text-only)
                                 │                      └─fail─> Gemini ─> gateway
                                 └─ have text? ─no──> Gemini VISION (whole image)
                                       │
                                       └─ finalize: normalize → batch defaults →
                                          needs_review → duplicate check →
                                          write `extractions`, status = success
```

**Stack**: TanStack Start (React + Nitro — one app, frontend and API routes in the
same route tree), Supabase, Groq + Gemini, FastAPI + PaddleOCR in `ocr-service/`.

OCR does not extract fields — it only turns the image into text. Every field
value comes from either the template parser or a model. OCR exists to make the
model call cheap (text instead of an image, and text can go to Groq for free),
not to make it more accurate. See §2.5.

**Two Supabase projects, and this matters:**

| | Project | Used for |
|---|---|---|
| `SUPABASE_*` | `gvdqvxybptxqzvwtipzd` | auth only |
| `EXT_SUPABASE_*` | `iggnmbkylikybpespgsr` | all real data — orders, extractions, partners |

The external project **belongs to the client**. Its data, its keys, its billing.
Do not change its schema, rotate its keys, or pause anything on it without the
client explicitly agreeing — other deployments of theirs read from it.

**Key files**

| Path | What it is |
|---|---|
| `src/lib/extract-core.server.ts` | Orchestration: claim → read → template → AI → persist. Start here. |
| `src/lib/extraction/ocr-read.server.ts` | The OCR call. Returns `null` on every failure, by design. |
| `src/lib/extraction/prompt.ts` | System prompt + the zod schema the model must return |
| `src/lib/extraction/batch-sync.server.ts` | Recomputes batch counts; fires the batch-completed notification |
| `src/lib/template-extract.ts` | Free label-matching fast path for the client's own layout (§2.5, §2.8) |
| `src/lib/template-extract.test.ts` | The parser's tests — `npm test`, 19 cases |
| `src/lib/import-processing.ts` | **Browser-side** ZIP/PDF/HEIC expansion + resize, before upload |
| `src/lib/batch-actions.functions.ts` | Creates the batch, the rows, and the signed upload URLs |
| `src/lib/queue.functions.ts` | Server functions the batch page calls |
| `src/lib/format.ts` | `EXTRACT_FIELDS`, `normalizePhone`, `normalizeCnic`, `avgConfidence` |
| `src/routes/_authenticated/batches.new.tsx` | Upload page |
| `src/routes/_authenticated/batches.$id.tsx` | Batch page; **drives processing from the browser** |
| `src/lib/inngest.server.ts` | Background worker definitions + the stale-requeue cron |
| `src/integrations/supabase/types.ts` | Generated schema types — the source of truth for column names |
| `ocr-service/app/main.py` | OCR HTTP service |
| `ocr-service/app/preprocess.py` | decode → resize → denoise → contrast → deskew |
| `ocr-service/Dockerfile` | Prod CMD — note `--workers ${UVICORN_WORKERS:-2}` (§2.6) |
| `ops/*.sh` | deploy, rollback, status, logs, health, backup, secrets-check |

---

## 2. Traps that have already cost a day

### 2.1 The `extractions` table has fewer columns than the code assumed

There is **no `ocr_text`, no `processing_completed_at`, no `raw_ocr_text`**
column. Writes to them are rejected outright by PostgREST, which fails the
*entire* update.

Two of those were being written. Both updates were cast `as any`, so nothing
caught it at build time, and neither checked its result at runtime — so the row
stayed exactly as it was found, the page re-drove it, the OCR ran again, and the
only visible symptom was a row stuck on "queued" while the OCR service logged
repeated *successful* requests.

**Rules that follow:**
- Check the result of every write that owns a row's state. `.select("id")` and
  treat zero rows as a failure.
- Before adding a field to an update, confirm the column exists in
  `src/integrations/supabase/types.ts`. Do not trust `as any`.
- The column list below was captured when `types.ts` had 46 columns and is now
  out of date (48). **Read `types.ts` instead — it is regenerated and accurate
  as of 2026-09-16.** Kept only as a rough shape:
  `id, batch_id, created_by, storage_path, file_name, status, error_message,
  customer_name, phone_number, current_network, number_charges, paid_via,
  discount, email, store_id, reference, deposit, remaining_deposit, order_number,
  cnic, plan_price, activation_date, activation_time, employee_name, branch_name,
  order_status, remarks, confidence, avg_confidence, needs_review, is_duplicate,
  duplicate_of, edited_fields, raw_response, created_at, updated_at, sim_type,
  number_type, package_name, activation_date_parsed, order_number_normalized,
  partner_id, commission_amount, commission_month, anomalies, workspace_id`

`batches.$id.tsx` still reads `raw_ocr_text` for a "view OCR text" panel
(`batches.$id.tsx:880-921`). That column doesn't exist either, so the panel never
renders. Harmless, but it is dead code, not a feature.

**Two more mismatches between the field list and the schema, both live:**

- ~~`alternative_contact` is not a column.~~ **Wrong — it exists.** This entry
  said otherwise for a while because `types.ts` was stale (see §2.11). The live
  table has 48 columns, not the 46 listed below, and `alternative_contact` is
  one of them. The missing-column retry in `finalizeExtraction` was therefore
  never firing for it. Left here as a warning: a claim about the schema that
  came from a stale `types.ts` is not a claim about the schema.
- **`order_number_normalized` is read but never written.** The duplicate check
  filters on it (`extract-core.server.ts:411`) and nothing in this repo assigns
  it. `types.ts` lists it in both `Insert` and `Update`, so it is an ordinary
  writable column, not a generated one — meaning if no DB trigger populates it,
  `is_duplicate` silently never fires. **Unverified.** Confirm before trusting
  duplicate detection:
  `select count(*) filter (where order_number_normalized is not null), count(*) from extractions;`

### 2.2 Another deployment writes to the same database

The client runs their **own Vercel deployment** of this app against the same
external Supabase project. It has older code (`gemini-2.0-flash`) and older config
(an OCR URL on a dead Cloud Run service), and it has Inngest keys — so
`requeueStaleExtractions` fires there **every 2 minutes**, finds rows sitting in
`pending`/`processing` past a 2-minute cutoff, requeues them, and processes them
with that stale config. No browser tab needed.

That is why rows kept coming back `failed` with `503` or a retired-model `404`
while this VPS was doing the work correctly.

**Fingerprints of that other worker**, if failures look inexplicable:
- `OCR service failed (503)` — its dead Cloud Run URL
- `models/gemini-2.0-flash is no longer available` — its old model
- `Recovered stale processing job — retrying automatically` — its requeue cron

**What is in place on our side** (none of it needs the client to act):
1. `runExtraction` heartbeats `updated_at` every 30s while it holds a row, so a
   slow-but-healthy job never looks abandoned.
2. `keepBatchRowsFresh` does the same for a batch's still-`pending` rows while
   its page is open — otherwise rows waiting their turn age past the cutoff.
3. The batch page re-drives rows that failed with those fingerprints, capped at
   3 attempts.

The clean fix is still the client removing `INNGEST_EVENT_KEY` /
`INNGEST_SIGNING_KEY` from their Vercel deployment, or pausing it. Worth asking
for; don't wait on it.

### 2.3 Every build needs `inlineDynamicImports`

Nitro 3 beta + the Rolldown-based Vite 8 bundler splits
`@tanstack/react-start`'s server entry into two chunks that import each other
circularly. One needs the other's `__exportAll` helper before it is assigned, so
**every request** 500s with `TypeError: __exportAll is not a function`.

`vite.config.ts` sets `inlineDynamicImports: true` unconditionally in the `nitro`
block. This was originally scoped to the `node-server` preset only, on the
assumption Vercel's own build path didn't hit the split — that assumption was
wrong: a real Vercel deployment hit the identical `__exportAll is not a
function` 500 on every route (confirmed via Vercel's Runtime Logs) until the
condition was removed. If this line disappears, expect the same crash on
**any** target (VPS or Vercel), not just one.

### 2.4 Processing is driven from the browser

The batch page claims and processes rows itself (`processExtractionNow`),
`MAX_PARALLEL_WORKERS = 4` at a time (`batches.$id.tsx:413` — these notes said 12
for a while; the code has said 4 since the pool was resized to match OCR
concurrency). Closing the tab stops the work. This is not a background queue on
the VPS — Inngest keys are deliberately unset here, so `queueExtractions` always
takes its `fallback: "direct"` branch (`queue.functions.ts:100`) and this
deployment never runs the cron.

The page runs **three** separate effects and they are easy to confuse:

| Effect | What it does | Line |
|---|---|---|
| auto-queue | re-queues `pending` / stale-`processing` rows, 5s debounce | `batches.$id.tsx:261` |
| heartbeat | `keepBatchRowsFresh` every 30s on still-`pending` rows | `batches.$id.tsx:290` |
| direct-processing | the 4-worker pool that does the actual work | `batches.$id.tsx:334` |

**One retry branch is uncapped.** `MAX_AUTO_RETRIES_PER_ROW = 3` gates only the
`isForeignWorkerFailure` half of `isRedrivableFailure` (`batches.$id.tsx:72`).
The `isRecoverableQueueFailure` half (`:71`) has no cap at all — just a 5s
backoff via `directRetryAfter`. A row that keeps failing with one of those
messages is re-driven every 5 seconds for as long as the tab stays open, and
**every re-drive is a fresh AI call**. Not fixed.

### 2.5 Four things can answer an extraction, not one

These notes used to say "Gemini". The real chain, in order, all in
`extract-core.server.ts`:

| # | Path | Model | Runs when | Line |
|---|---|---|---|---|
| 1 | template | none (string matching) | OCR text, OCR confidence ≥ `TEMPLATE_MIN_CONFIDENCE` (90), all three core fields matched, **and** `TEMPLATE_EXTRACTION_ENABLED=true` | 178-192 |
| 2 | Groq | `openai/gpt-oss-120b` | `ocrText` **and** `GROQ_API_KEY` both present. Free. | 243-254 |
| 3 | Gemini direct | `gemini-3.6-flash` | Groq skipped or failed, `GEMINI_API_KEY` set | 272-285 |
| 4 | Lovable gateway | `google/gemini-3.6-flash` | Gemini direct failed or threw, `LOVABLE_API_KEY` set | 220, 290, 307, 311 |

Two consequences worth internalising:

- **Groq is never sent an image.** It is gated on `ocrText` existing
  (`extract-core.server.ts:243`) and no vision endpoint is used for it. So an
  OCR failure costs twice: it loses the free path *and* forces the expensive
  vision path. Anything that raises the OCR hit rate is an AI-spend lever, not
  an accuracy lever.
- **The template path is DISABLED.** `TEMPLATE_EXTRACTION_ENABLED` defaults to
  `"false"` in the code (`extract-core.server.ts:182`) and in `.env.example`.
  The parser still runs and logs
  `[shadow] template would match for {id}: {...}`, then falls through to the AI
  regardless. As shipped it saves nothing. See §2.8 for what it now handles and
  what still has to be checked before enabling it.

`LOVABLE_API_KEY` is read at `extract-core.server.ts:73` and checked by
`ops/secrets-check.sh:24`, but **is not in `.env.example`** — so whether path 4
exists at all depends on the server's `.env`. Check before assuming a fallback.

`raw_response` records which path answered:
`{ source, data, confidence, ocrUsed }` (`extract-core.server.ts:386`), where
`source` is `template|groq|gemini|gateway`. That JSON is the only way to see the
mix without reading logs — see §6.

### 2.6 `OCR_MAX_CONCURRENCY=1` does not mean one inference per container

`_inference_slot = asyncio.Semaphore(OCR_MAX_CONCURRENCY)` (`main.py:41`) lives
inside **one Python process**, and the prod image starts
`uvicorn --workers ${UVICORN_WORKERS:-2}` (`ocr-service/Dockerfile:69`;
`ocr-service/.env.example` also sets `UVICORN_WORKERS=2`). So:

```
container inference slots = UVICORN_WORKERS × OCR_MAX_CONCURRENCY = 2 × 1 = 2
```

Each worker also eager-loads its own PaddleOCR engine at startup
(`main.py:96`), so the model sits in memory twice.

The comment at `main.py:38-40` and the `OCR_MAX_CONCURRENCY` note in
`ocr-service/.env.example` both promise a one-at-a-time guarantee that only
holds per process. Given §3's ~5.9 GB peak for a single dense page, two
concurrent inferences do not fit inside any limit this project sets.
**`UVICORN_WORKERS=1` is the cheapest way to make the semaphore mean what its
own comment says** — halves resident memory and removes the second model copy.
Not yet done, not yet measured.

### 2.7 Two files with the same name collide on upload

`batches.new.tsx:190` matches each file to its signed-upload token with
`uploadTokens.find(t => t.fileName === f.name)`. Tokens are keyed by filename
only, and `createBatchWithExtractions` issues one per file
(`batch-actions.functions.ts:63-104`). Two files sharing a name — easy once a
ZIP is flattened to basenames (`import-processing.ts:112`), or when two ZIPs
each contain `1.jpg` — both resolve to the **first** token. One image uploads
twice; the other `extractions` row never receives its image and later fails with
§6's "Could not read screenshot". Not fixed.

Also note the upload loop itself is sequential (`batches.new.tsx:190-218`, one
`await` per file). A 500-image batch uploads one at a time.

### 2.8 The template parser, and what the 35 sample screenshots taught it

Every image in this workload is the same page: the operator's "Summary" screen
for one SIM order. `src/lib/template-extract.ts` parses it by label, with no AI
involved. `npm test` covers it (`src/lib/template-extract.test.ts`, 19 cases).

**What the page actually contains.** Order code, placement timestamp, SIM type,
number type, phone number, name, CNIC, and — conditionally — current network,
alternate contact, email. It has **no** package, price, charges, deposit,
discount, reference, order status or remarks fields. Those `EXTRACT_FIELDS`
entries staying null on a template row is correct, not a parse failure. Do not
"fix" it by widening the parser.

**`Number type` decides the phone label.** "New number" → `Onic Number`.
"Number transfer" → `Current Number` *plus* a `Current Network` line. The
parser makes `current_network` required only on transfers.

**Four things the first version got wrong**, all found by replaying the samples
through it (`git show HEAD~1:src/lib/template-extract.ts` for the old one):

| Sample shape | Old behaviour | Why |
|---|---|---|
| Any September order | refused → AI call | month pattern was `[A-Za-z]{3}`; the page writes "Sept" |
| Full-window capture | refused → AI call | order code was read from line 0, which is "Summary" |
| Cropped top (no label) | matched, **timestamp blank** | date/time pattern required exact spacing |
| Pencil glyph beside a label | matched, **CNIC blank** | label patterns were `$`-anchored |

Of eight representative samples, the old parser refused four and silently
returned an incomplete row for three more. **The incomplete ones are the
dangerous half**: they save as `success` with high confidence and nothing
surfaces them. That is why `REQUIRED_FIELDS` now lists all eight fields present
on every sample, rather than the three it used to check.

**Per-line confidence.** `readWithOcr` now returns the OCR service's
`lines: [{text, confidence}]` and the parser gates each required field on the
score of the line it actually came from. Before this, one blurry line of page
chrome (a status bar, an FAQ heading) dragged the page average under
`TEMPLATE_MIN_CONFIDENCE` and threw away a read whose fields were perfect.

**Two decisions still open, both left alone deliberately:**
- `Registered Number` appears on one sample where `Alternate Contact` usually
  sits, and its value is the same number as that order's own `Onic Number`. It
  is therefore not an alternate contact, so it is **not mapped** to anything
  until someone confirms what the label means.
- `alternative_contact` is extracted but **has no column** (§2.1). Every row
  carrying it pays a rejected UPDATE plus the retry at
  `extract-core.server.ts:427`.

**The "|" in the timestamp splits into two OCR lines, sometimes.** The page
renders `13 Sept 2026 | 01:44 PM`. PaddleOCR emits one line per detected text
box, so depending on how wide a gap that glyph opens, the row arrives either
glued (`08 Aug202611:50 AM`) or as two separate lines (`09 Sept 2026` then
`04:28 PM`). Both are confirmed from production rows. Handling only the glued
form refused five rows of a live 25-image batch for "missing
activation_date/activation_time" — they went to Groq, which cost nothing but
also returned null for both fields, which is how the split was spotted at all.
The parser now reads both shapes.

**The order code is what OCR mangles most.** It is a long run of ambiguous
glyphs, and losing it loses the whole row — both the required set and the
fallback scan hang on it. A live batch refused rows with **all nine other
fields present** and only `order_number` missing. Three shapes are now handled,
all seen or plausible from the same box-splitting behaviour as the timestamp:
the code alone on a line (with internal spaces tolerated), split across two
boxes (`CXO-` / `4CISTI…`), and merged into one box with its own label
(`Order number CXO-4CISTI…`). The embedded form additionally requires a digit
in the tail, because ordinary hyphenated English otherwise matches — all 35
sampled codes contain a digit and `Self-pickup` does not.

**A refusal now says why.** `[template] refused <order_number> — missing: ...`
is logged whenever the parser recognised the layout (it found an order code)
but bailed on a required field. Before this a near miss was completely silent,
and working out *which* field was missing meant querying already-saved rows and
hoping the AI had left the same ones null.

**Is CNIC really required? — mostly settled.** A live 25-image batch put 6 of 7
non-template rows through the AI with a CNIC present, so the CNIC requirement
was not what refused them (the timestamp was). Keep it required. The original
concern: `REQUIRED_FIELDS`
includes `cnic` because all 35 reviewed screenshots carry it, and a SIM
registration row without one is not worth saving. But the `REAL_SAMPLE` fixture
that arrived with the test suite — commented "confirmed against a live upload"
— has **no CNIC line**, and its field order differs from every one of the 35
screenshots. One of the two is unrepresentative and it is not yet known which.

The fixture was given its CNIC pair so the suite reflects the 35 screenshots,
i.e. the strict reading. **If the shadow logs from a real batch show rows
matching without a CNIC line, that choice is wrong** and `cnic` should move out
of `REQUIRED_FIELDS` — being wrong this way costs AI calls, whereas being wrong
the other way writes incomplete rows into the client's database, which nothing
surfaces. Settle it with data:

```bash
docker logs orderscan-app --since 30m | grep -c "\[shadow\]"     # how many matched
docker logs orderscan-app --since 30m | grep "\[shadow\]" | tail -5
```

A shadow count well below the batch size means the gate is too strict; check
whether the missing field is `cnic` before loosening anything else.

**Test fixtures other than `REAL_SAMPLE` are transcriptions of what is visible
on the screenshots, not captured OCR output.** They prove the parser handles the
layout and the known mangling; they do not prove PaddleOCR emits those exact
lines on the VPS.

### 2.9 Bulk batches deadlock on the database, not on OCR

*Result after the fixes below: a 25-image batch went 18/25 with 7 rows wedged →
**25/25, zero failures**, 6 write conflicts all absorbed by retry. Source split
`{ template: 19, groq: 5, gemini: 1 }` — 24 of 25 rows cost nothing.*


A live 25-image batch produced 18 successes, 2 rows wedged in `processing` and
5 bouncing in `pending`, with the log full of:

```
[extract-core] Save result for <id> deadlocked, retrying (attempt 3/3)
[extract-core] Could not save extracted fields: deadlock detected
[extract-core] Could not claim extraction: deadlock detected
[extract-core] Could not claim extraction: canceling statement due to statement timeout
```

OCR and the AI were fine — every row had already been read. **The writes lost.**

**Why it happens.** One open batch page is many independent writers against the
same handful of rows at once: N direct-processing workers doing per-row claims
and saves, the auto-queue effect re-running `queueExtractions` (a multi-row
`UPDATE ... WHERE id IN (...)`) every 5s, `keepBatchRowsFresh` doing another
multi-row update every 30s, a 30s heartbeat per in-flight row, and
`syncBatchCounts` after *every* row — which re-SELECTs the whole batch and then
updates the one shared `batches` row.

**Why rows got stuck rather than just slow.** Three compounding reasons, all now
fixed:

1. Retries were 3 attempts at flat 50-200ms — about 375ms of runway against
   contention lasting far longer, and every contender retried on the same
   schedule so they re-collided. Now 5 attempts, exponential with jitter, ≈3s.
2. Statement timeouts (57014) were not treated as retryable, though under this
   contention a statement times out *because* it waited on someone else's lock.
   Now retried on the same path.
3. **The failure paths themselves were unchecked bare updates.** When
   "mark this row failed" lost a deadlock — most likely exactly then, since it
   runs right after a write that already deadlocked — the row was left in
   `processing` with no error and no owner. That is the two wedged rows. All
   three now go through `markExtractionFailed`, which retries and shouts if it
   still cannot record the failure.

**And two changes that stop generating the contention:**

- `MAX_PARALLEL_WORKERS` 4 → **2** (`batches.$id.tsx`). Throughput is bounded by
  OCR either way; the worker count only scaled the write contention.
- `syncBatchCounts` now skips the `batches` UPDATE when the counts and status
  are unchanged. Several workers finishing in the same moment all recompute the
  same totals and used to queue identical writes against one row.

**Retries alone were not enough, and the fix was to stop generating the
contention.** A later batch still produced `Could not even mark <id> failed:
deadlock detected` after all five attempts, and wedged a row in `processing`
again. `syncBatchCounts` now **coalesces**: concurrent callers for one batch
share a single recompute (`BATCH_SYNC_COALESCE_MS`, default 500). A 25-image
batch used to do 25 full SELECTs of the batch plus up to 25 writes to the one
shared `batches` row; it now does a handful. Callers still await a real
recompute — the map entry is released *before* the write, so anything finishing
mid-write queues a fresh run and the final state is always written.

**Still open:** `queue.functions.ts` keeps its own second copy of the count
logic (see that file's comment) and contends with this one. The browser's
auto-queue effect (5s) and `keepBatchRowsFresh` (30s) are both multi-row
UPDATEs against the same rows the workers are claiming.

**Reading the logs.** `docker logs orderscan-app | grep -c "OCR read"` counts
*more* than the batch size when rows are re-driven; that is the symptom, not a
miscount. Note `docker logs` sends container stderr straight to the terminal,
bypassing a pipe — warnings and errors will appear around a `grep -c` result
rather than being counted by it.

### 2.10 Database-side triggers block writes the code knows nothing about

None of this is in the repo — it lives in the client's Supabase project as
PL/pgSQL, so it is invisible to `grep` and to `types.ts`. It surfaces only as a
failed statement.

`month_locks` holds a per-workspace month lock, and
`enforce_month_lock_on_extractions()` raises on **any** write to an
`extractions` row in a locked month:

```
ERROR: Month 2026-08 is locked. Unlock it before editing activations.
```

The trap is that it fires *transitively*. Deleting a `commission_slabs` row
looks unrelated to extractions, but:

```
DELETE commission_slabs
  -> trigger trg_partner_slab_recompute()
       -> recompute_partner_commission()
            -> UPDATE extractions SET commission_amount = ...
                 -> trigger enforce_month_lock_on_extractions()  -> RAISE
```

So a locked month can block edits to partners, slabs and payouts, not just to
the activations themselves. **Clear `month_locks` first** when a bulk change
has to touch historical data — that is the schema's own unlock path, and is far
better than reaching for `SET session_replication_role = replica`, which
disables every trigger *and* every foreign-key check at once.

**Wiping the data (done once, 2026-09-16, at the client's request):** delete in
FK order with `DELETE`, not `TRUNCATE ... CASCADE` — `profiles` has
`profiles_active_workspace_id_fkey` to `workspaces`, so CASCADE would silently
take the user accounts with it. Null that column first, keep `profiles`,
`user_roles` and `user_recovery_codes`, and wrap the whole thing in
`BEGIN; ... COMMIT;` so a trigger failure rolls back instead of leaving a
half-wiped database. Expect `audit_logs` to be non-zero afterwards: the
deletions write their own audit rows.

Storage is separate and is **not** cleared by any of that. Deleting from
`storage.objects` in SQL removes the listing but can leave the file behind; use
the Storage REST API (`POST /storage/v1/object/list/<bucket>` to walk,
`DELETE /storage/v1/object/<bucket>` with `{prefixes: [...]}` in batches of
100). 1282 wiped rows left 1285 orphaned screenshots.

### 2.11 `types.ts` was stale, and `as any` hid it

`src/integrations/supabase/types.ts` is generated from the database, and it had
drifted badly: **23 tables typed, 32 actually in the database.** Nine real,
in-use tables were missing from it —

```
activation_types  brand_invoices  brand_receipts  brand_slabs  brands
employees_advances  month_closes  payout_payments  refund_requests
```

— along with two extra `extractions` columns, one of which was
`alternative_contact` (see §2.1, where the stale file caused a wrong entry).

Because every one of those tables was reached through an `as any` cast, nothing
complained. That is the whole cost of the cast: it does not just silence noise,
it switches off the check that catches a wrong or missing column. Two real bugs
were sitting behind it and surfaced the moment the casts came off:

| Bug | Effect |
|---|---|
| `report_views` insert had no `workspace_id` (NOT NULL) | "Save view" on All Orders could never work |
| `scheduled_reports` insert had no `workspace_id` (NOT NULL) | Creating a report schedule always failed |

Both had been unreachable-by-typecheck since they were written.

**Regenerate after any migration** — this is the step that was being skipped:

```bash
npx supabase login                       # personal token from supabase.com/dashboard/account/tokens
npx supabase gen types typescript --project-id iggnmbkylikybpespgsr > src/integrations/supabase/types.ts
```

Sanity check: the `public` schema should list **32** tables. Note the generated
file now starts with a `graphql_public` schema block whose `Tables` is empty, so
a naive "first Tables block" parser reads zero — count inside `public`.

**Still to do:** ~111 `as any` casts remain on update/insert *payloads* (brand,
commission, employees, billing, notifications, partners, month-close). Each one
is a place the typechecker is still blindfolded, and the two bugs above are what
that tends to be hiding. Removing them is the next pass; they need looking at
individually rather than stripping in bulk.

---

## 3. OCR service — measured behaviour

Numbers from the VPS, real single-page upload (1224×1584 PNG, 378KB, 43 text
lines), `paddleocr 2.9.1` + `paddlepaddle 3.0.0`:

| | Resident memory | Time |
|---|---|---|
| After model load | 587 MB | — |
| After one inference | **5920 MB** | 6–13 s |
| Repeat runs, same page | flat at ~5900 MB | — |
| Synthetic page, 30 lines all the same width | 2231 MB | 3.4 s |

When the worker is killed mid-request the app sees `SocketError: other side
closed` with `bytesRead: 0`.

**Confirmed on the VPS: the container limit is 6 GB**, so the server's
`ocr-service/.env` sets `OCR_MEMORY_LIMIT=6g`. Do not read the repo default as
the live value — they differ:
`ocr-service/docker-compose.prod.yml:16` sets `mem_limit: ${OCR_MEMORY_LIMIT:-4g}`
with `memswap_limit: ${OCR_MEMORY_SWAP_LIMIT:-8g}` (`:22`), and
`ocr-service/.env.example` also carries `OCR_MEMORY_LIMIT=4g`. Whichever value
the server's `.env` actually sets, one real page at ~5.9 GB does not fit
comfortably in it — and per §2.6 **two** pages can be in flight at once. Confirm
the live numbers before reasoning about an OOM:

```bash
docker inspect orderscan-ocr --format '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}}'
```

What this data says:
- **No leak.** Repeat runs plateau; memory is reused.
- **Cost tracks distinct shapes**, not page size — a page whose lines all share
  one width costs a third as much.
- **Detection sizing is not the lever.** `det_limit_side_len` 960 → 640 moved
  memory 5920 → 5734 MB and doubled the time.
- The host is 2 vCPU / 7.7 GB with **`markx.pro` also running on it**, plus 2 GB
  of swap added manually.

**Untested and still the most promising lever**: `paddleocr 2.9.x` targets the
paddlepaddle **2.x** runtime. `requirements/base.txt` now pins
`paddlepaddle==2.6.2`, but that build has not been deployed and measured. Do that
before trying anything more elaborate. Reproduce with:

```bash
docker cp /tmp/test.png orderscan-ocr:/tmp/test.png
docker exec orderscan-ocr python -c "import numpy as np; from paddleocr import PaddleOCR; from app.preprocess import preprocess; buf=open('/tmp/test.png','rb').read(); cur=lambda: int(open('/proc/self/statm').read().split()[1])*4096//1048576; e=PaddleOCR(use_angle_cls=True,lang='en',show_log=False,det_limit_side_len=960,rec_batch_num=6,cpu_threads=2); print('MODEL_MB',cur()); r=e.ocr(np.asarray(preprocess(buf)),cls=True); print('lines',len(r[0]) if r and r[0] else 0,'cur_MB',cur())"
```

If it still sits near 6 GB, OCR on this host needs either a bigger VPS or
per-request process isolation (slow — model load is ~600 MB and tens of seconds).
The fallback means neither is urgent.

**Why OCR is kept at all**: the client asked for it. It is the primary path;
`readWithOcr` (`src/lib/extraction/ocr-read.server.ts`) returns `null` on any
failure — no `OCR_URL`, 503 busy, 45s timeout, empty text, dead worker — and the
screenshot goes to the model directly. Never turn an OCR failure into a failed
row.

### How much of a bulk batch actually reaches OCR

Not all of it, and this is the single biggest driver of AI spend. With the
defaults — `MAX_PARALLEL_WORKERS = 4` (`batches.$id.tsx:413`), two container
inference slots (§2.6), `OCR_FAIL_FAST=true` (`main.py:51`) — a browser worker
that finds every slot busy gets an instant 503, `readWithOcr` returns `null`
(`ocr-read.server.ts:57`), and that image goes to Gemini **as an image**, which
also skips Groq entirely (§2.5).

A queueing estimate from those numbers, assuming ~8 s per inference and ~4 s per
vision call, puts the OCR share of a large batch around 40-45% — i.e. most rows
take the expensive path. **That is an estimate, not a measurement.** Inference
time is the sensitive input and has not been re-measured since the
`paddlepaddle` pin changed. Measure it with the queries in §6 before acting on
it.

`OCR_FAIL_FAST=false` trades worst-case latency for OCR coverage, and coverage
is what costs money here: a row that reaches OCR is answered by Groq for free
instead of by Gemini vision. It does **not** raise memory — the semaphore is
unchanged; it only makes requests queue instead of bounce.

**Cost of the fallback path**, for when this comes up: an image is ~1030 tokens
(258 per 768×768 tile), the system prompt ~1400, the JSON answer ~500. At
gemini-3.6-flash rates ($0.75/M in, $3.75/M out through 2026) that is roughly
**$0.004 per image** — about 5–10% more than sending OCR text, because the
transcript of a dense page is not much cheaper than the page.

---

## 4. Deployment

**VPS**: `168.231.118.250`, user `deployer`, password auth (no working SSH key).
**It is shared with an unrelated production site, `markx.pro`** — its containers
are `markx_app` (3000), `markx_chat` (3004), `markx_db` (5432), and its nginx owns
ports 80 and 443. Never touch those, and never enable this project's nginx/SSL
profile without checking with the user first.

| | Port | Container |
|---|---|---|
| App | 3001 | `orderscan-app` |
| OCR | 8001 | `orderscan-ocr` |

Both join the `orderscan-net` docker network so the app can reach OCR at
`http://ocr:8080` (containers always listen on 8080 internally; the published
port is separate). `ops/deploy.sh` creates the network on either side, so the app
comes up even if OCR was never deployed.

```bash
cd ~/hitrotech-orderscan
git pull

bash ops/deploy.sh                       # app only  (src/** changed)
cd ocr-service && bash ops/deploy.sh     # OCR only  (ocr-service/** changed)

bash ops/status.sh                       # containers, health, memory, images
bash ops/logs.sh
bash ops/rollback.sh                     # previous image is tagged :prev
```

`deploy.sh` builds, starts, health-checks, and **rolls back automatically** if the
new image fails its check.

`.env` lives on the server only, one per half, `chmod 600`, never committed.
`ops/secrets-check.sh` validates both. `.env.example` in each half is the
reference.

### Deployment gotchas

- **Confirm the pull actually landed** before deploying: `git log --oneline -1`.
  A deploy of unchanged code looks like a successful deploy and wastes a debug
  cycle. This has happened more than once.
- Multi-line paste into the VPS shell **garbles**. Give one-line commands.
- `git pull` may abort over file-mode changes if anyone ran `chmod +x`. The ops
  scripts are committed executable now, so this should be settled; if it recurs,
  `git diff --numstat` showing all `0 0` means it is only mode bits and
  `git checkout -- ops ocr-service/ops` is safe.
- The repo is private; the VPS clones over HTTPS with a **classic** PAT (`repo`
  scope). Fine-grained tokens return 403 on clone. `credential.helper store` is
  configured there.

---

## 5. Local development (Windows)

```bash
npm install
npm run dev
```

Building the VPS target on Windows: `npm run build:vps` **fails** — the script
uses POSIX `VAR=value` prefix syntax. Use the Bash tool:

```bash
NITRO_PRESET=node-server ./node_modules/.bin/vite build
PORT=8099 node .output/server/index.mjs      # then curl /api/health
```

`npm test` (vitest, 120 tests) and `npx tsc --noEmit -p tsconfig.json` are the
useful checks — both pass clean, so any failure is genuinely yours.
**`npm run lint` is not**
— the repo has ~1600 pre-existing errors (CRLF line endings and
`no-explicit-any`) in files nobody touched, so lint output says nothing about a
change. Compare against an untouched file before believing a lint error is yours.

Test account: `testaccount@hitrotech.dev` / `OrderScan#Test2026`

---

## 6. Diagnosing a stuck or failed extraction

The UI's status badge is not enough — read the row. `curl` inside the app
container has no CA bundle, so use `node`, which has its own:

```bash
# latest rows: status, error, timing
docker exec orderscan-app node -e "const K=process.env.EXT_SUPABASE_SERVICE_ROLE_KEY;fetch(process.env.EXT_SUPABASE_URL+'/rest/v1/extractions?select=status,error_message,updated_at&order=updated_at.desc&limit=5',{headers:{apikey:K,Authorization:'Bearer '+K}}).then(r=>r.json()).then(j=>j.forEach(x=>console.log(x.updated_at,'|',x.status,'|',(x.error_message||'').slice(0,120))))"

# every column the table actually has
docker exec orderscan-app node -e "const K=process.env.EXT_SUPABASE_SERVICE_ROLE_KEY;fetch(process.env.EXT_SUPABASE_URL+'/rest/v1/extractions?select=*&limit=1',{headers:{apikey:K,Authorization:'Bearer '+K}}).then(r=>r.json()).then(j=>console.log(Object.keys(j[0]).join(', ')))"

# app logs without the healthcheck noise
docker logs orderscan-app --tail 40 | grep -v health

# was the OCR worker OOM-killed?
sudo dmesg -T | grep -i "killed process" | tail -5
docker stats orderscan-ocr --no-stream

# how often OCR is being skipped, and how long it takes when it works
docker logs orderscan-app --since 30m | grep -c "OCR unavailable"
docker logs orderscan-app --since 30m | grep "OCR read" | tail -20
docker logs orderscan-ocr --since 30m | grep -c "OCR busy"

# what the template path WOULD have returned, if it were enabled (§2.5)
docker logs orderscan-app --since 1h | grep "\[shadow\]" | tail -20
```

**Which path answered, and how often OCR actually ran** — the question §3's
estimate needs measured. Run in the `EXT_` project's SQL editor:

```sql
SELECT raw_response->>'source'  AS provider,
       raw_response->>'ocrUsed' AS ocr_used,
       count(*),
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
FROM extractions
WHERE batch_id = '<BATCH_ID>' AND status = 'success'
GROUP BY 1, 2
ORDER BY 3 DESC;
```

`source = gemini|gateway` with `ocr_used = false` is the expensive path. In the
UI the same fact shows as a small **"No OCR"** badge on the row
(`src/components/StatusBadge.tsx:39-45`).

Reading the errors:

| Symptom | Cause |
|---|---|
| `bytesRead: 0`, `SocketError: other side closed` | OCR worker died mid-request (OOM) |
| `no rows matched` on an update | Column doesn't exist, or RLS blocked the write |
| `503` / `gemini-2.0-flash` / `Recovered stale processing job` | The client's Vercel deployment, not this one |
| Row stuck on "Queued", OCR logs repeated successes | A write is failing and being ignored |
| Every request 500s, `__exportAll is not a function` | `inlineDynamicImports` missing from the VPS build |
| Row succeeded but carries a "No OCR" badge | OCR was busy or down; that row took the Gemini vision path (§2.5) |
| `Invalid AI response schema` | Model returned non-JSON or the wrong shape. Marked `failed`, **not** retried (`extract-core.server.ts:336`) |
| `Could not read screenshot` on a row whose siblings worked | Its image was never uploaded — likely the duplicate-filename collision (§2.7) |
| AI spend higher than expected on a clean batch | Check the §6 SQL: most rows probably show `ocr_used = false` |

---

## 7. State of play

Working: deployment, login, upload (with browser-side ZIP/PDF/HEIC expansion),
extraction end to end (verified — a real upload reached `success` with fields
populated), auto-rollback, heartbeats against the foreign worker,
OCR-with-fallback, Groq-before-Gemini for the text path.

**Config-only, no deploy, highest value first** — none of these need code
changes or the client:
- `UVICORN_WORKERS=1` in `ocr-service/.env` (§2.6). Halves OCR memory and makes
  `OCR_MAX_CONCURRENCY` mean what it claims. Do this before anything else about
  OCR memory.
- `OCR_FAIL_FAST=false` (§3). More rows reach OCR, so more are answered by Groq
  for free instead of Gemini vision. Costs latency, not memory, not accuracy.
- Then re-run §6's SQL on one batch and see what the `source`/`ocr_used` mix
  actually became. Everything else here is guesswork until that number exists.

Open:
- Validate the template fast path and enable it (§2.5). It is the only change
  that removes AI calls outright rather than making them cheaper. Compare
  `[shadow]` log lines against the same rows' `raw_response->'data'` first.
- Deploy `paddlepaddle==2.6.2` and re-measure OCR memory (§3). Still unverified
  whether the running container has it.
- Decide `alternative_contact`: add the column or drop the field (§2.1). Right
  now every successful row pays a rejected UPDATE plus a retry.
- Verify `order_number_normalized` is actually populated (§2.1). If not,
  duplicate detection has never worked.
- Cap the `isRecoverableQueueFailure` retry branch (§2.4) — it is uncapped and
  each re-drive is a fresh AI call.
- Fix the duplicate-filename upload collision (§2.7).
- Duplicate detection runs *after* the AI call (`extract-core.server.ts:407`).
  Moving it before, keyed on the OCR/template `order_number`, would skip the
  call entirely for duplicates.
- Measure whether `OCR_DENOISE` / `OCR_CONTRAST` help or hurt on real
  screenshots — they are on by default and unproven for clean digital captures.
  Note images already arrive ≤1200×1600 JPEG from `import-processing.ts`, so
  `OCR_MAX_SIDE=1280` is close to a no-op for most of them.
- Ask the client to stop their Vercel deployment's Inngest cron (§2.2).
- `.env` was committed in two early commits and is still in git history. The keys
  in it are the client's; rotating them is the client's call, but they should be
  told.
- No domain or TLS yet. `ops/ssl-renew.sh` and the compose `proxy` profile are
  ready, but they bind 80/443 — coordinate with `markx.pro` first.

---

## 8. How to work on this

- **Measure before changing.** Nearly every wrong turn here came from a plausible
  theory that data contradicted in one command. Three separate root causes today
  looked identical from the UI.
- **Confirm what is deployed** before drawing conclusions from logs.
- The user runs the VPS commands. Give one at a time, one line each, and say what
  the output should look like.
- Prefer surfacing a failure over papering it into a default. Most of the day's
  debugging existed because writes failed silently.
- **This file is not the source of truth; the code is.** Several entries here
  were wrong for weeks (worker count, container memory, "Gemini" as the only
  provider) because the code moved and the notes did not. When they disagree,
  believe the code and fix the note in the same change.
- Values in `.env.example` are defaults, not what is running. The server's
  `.env` is the only authority on `TEMPLATE_EXTRACTION_ENABLED`,
  `UVICORN_WORKERS`, `OCR_FAIL_FAST`, `OCR_MEMORY_LIMIT` and whether
  `LOVABLE_API_KEY` exists at all. Check it before reasoning from a default.
