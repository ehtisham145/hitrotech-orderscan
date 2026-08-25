# HitroTech OrderScan — working notes

Upload order/receipt screenshots, read the fields out of them, store them in
Supabase. Admin panel and partner portal are the same app.

This file is the context an incoming session needs that the code does not say on
its own — the constraints, the traps, and the things that have already been
measured so they don't get re-derived.

---

## 1. Shape of the system

```
browser ──upload──> Supabase Storage (bucket: screenshots)
   │                     │
   │                     └─ row in `extractions`, status = pending
   │
   └──"process this row"──> app server (VPS)
                                 │
                                 ├─ download screenshot
                                 ├─ OCR service ──> text        (primary)
                                 │     └─ unavailable? send the image instead
                                 ├─ Gemini ──> structured JSON
                                 └─ write fields to `extractions`, status = success
```

**Stack**: TanStack Start (React + Nitro — one app, frontend and API routes in the
same route tree), Supabase, Gemini, FastAPI + PaddleOCR in `ocr-service/`.

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
| `src/lib/extract-core.server.ts` | The whole extraction routine. Start here. |
| `src/lib/queue.functions.ts` | Server functions the batch page calls |
| `src/routes/_authenticated/batches.$id.tsx` | Batch page; **drives processing from the browser** |
| `src/lib/inngest.server.ts` | Background worker definitions + the stale-requeue cron |
| `src/integrations/supabase/types.ts` | Generated schema types — the source of truth for column names |
| `ocr-service/app/main.py` | OCR HTTP service |
| `ocr-service/app/preprocess.py` | decode → resize → denoise → contrast → deskew |
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
- The live column list (46 of them):
  `id, batch_id, created_by, storage_path, file_name, status, error_message,
  customer_name, phone_number, current_network, number_charges, paid_via,
  discount, email, store_id, reference, deposit, remaining_deposit, order_number,
  cnic, plan_price, activation_date, activation_time, employee_name, branch_name,
  order_status, remarks, confidence, avg_confidence, needs_review, is_duplicate,
  duplicate_of, edited_fields, raw_response, created_at, updated_at, sim_type,
  number_type, package_name, activation_date_parsed, order_number_normalized,
  partner_id, commission_amount, commission_month, anomalies, workspace_id`

`batches.$id.tsx` still reads `raw_ocr_text` for a "view OCR text" panel. That
column doesn't exist either, so the panel never renders. Harmless, but it is dead
code, not a feature.

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

### 2.3 The VPS build needs `inlineDynamicImports`

Nitro 3 beta + the Rolldown-based Vite 8 bundler splits
`@tanstack/react-start`'s server entry into two chunks that import each other
circularly. One needs the other's `__exportAll` helper before it is assigned, so
**every request** 500s with `TypeError: __exportAll is not a function`.

`vite.config.ts` sets `inlineDynamicImports: true` for the `node-server` preset
only, so Vercel's build path is untouched. If that line disappears, the VPS build
compiles fine and then fails at runtime on every request.

### 2.4 Processing is driven from the browser

The batch page claims and processes rows itself (`processExtractionNow`), up to
12 at a time. Closing the tab stops the work. This is not a background queue on
the VPS — Inngest keys are deliberately unset here, so this deployment never runs
the cron.

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

Container limit is 6 GB, so a real page runs at the edge of an OOM kill. When it
is killed mid-request the app sees `SocketError: other side closed` with
`bytesRead: 0`.

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
`readWithOcr` in `extract-core.server.ts` returns `null` on any failure and the
screenshot goes to the model directly. Never turn an OCR failure into a failed
row.

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

`npx tsc --noEmit -p tsconfig.json` is the useful check. **`npm run lint` is not**
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
```

Reading the errors:

| Symptom | Cause |
|---|---|
| `bytesRead: 0`, `SocketError: other side closed` | OCR worker died mid-request (OOM) |
| `no rows matched` on an update | Column doesn't exist, or RLS blocked the write |
| `503` / `gemini-2.0-flash` / `Recovered stale processing job` | The client's Vercel deployment, not this one |
| Row stuck on "Queued", OCR logs repeated successes | A write is failing and being ignored |
| Every request 500s, `__exportAll is not a function` | `inlineDynamicImports` missing from the VPS build |

---

## 7. State of play

Working: deployment, login, upload, extraction end to end (verified — a real
upload reached `success` with fields populated), auto-rollback, heartbeats
against the foreign worker, OCR-with-fallback.

Open:
- Deploy `paddlepaddle==2.6.2` and re-measure OCR memory (§3). Nothing else about
  OCR is worth tuning until that number is known.
- Measure whether `OCR_DENOISE` / `OCR_CONTRAST` help or hurt on real
  screenshots — they are on by default and unproven for clean digital captures.
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
