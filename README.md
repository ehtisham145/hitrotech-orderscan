# HitroTech OrderScan

OrderScan is a partner/reseller order-processing and commission-management
platform built by **HitroTech**. Users upload order screenshots or images,
which are run through OCR and AI-based structured extraction, and the
resulting order data drives partner commissions, payouts, billing, and
reporting. The admin panel and the partner-facing portal are the same
application, gated by role.


### Table of contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Local development](#local-development)
- [Environment variables](#environment-variables)
- [Production deployment (VPS + Docker)](#production-deployment-vps--docker)
- [Day-2 operations](#day-2-operations)
- [Troubleshooting](#troubleshooting)

## What it does

1. A user uploads an order image/screenshot (individually or as a batch —
   ZIP, PDF, or a whole folder are also accepted).
2. The image is sent to the **OCR service** (`ocr-service/`, Python +
   FastAPI + PaddleOCR), which returns plain text — the image itself is
   never sent to the LLM.
3. That text is sent to **Gemini** for structured extraction (customer name,
   phone, order number, plan, price, activation date, etc.), with per-field
   confidence scores.
4. Extracted data is written to Supabase and used to calculate partner
   **commissions and payouts**.
5. Admins manage employees, partners, stores, billing plans, and reports
   from an admin dashboard. Partners get their own portal to see statements
   and performance. Duplicate orders and low-confidence fields are flagged
   for review automatically.

## Architecture

```
browser ──upload──> Supabase Storage (bucket: screenshots)
   │                     │
   │                     └─ row in `extractions`, status = pending
   │
   └──"process this row"──> app server
                                 │
                                 ├─ download screenshot (RLS-checked)
                                 ├─ OCR service ──> plain text
                                 ├─ Gemini ──> structured JSON + confidence
                                 └─ write fields to `extractions`, status = success
```

**Two Supabase projects — this is easy to miss and matters a lot:**

| | Used for |
|---|---|
| `SUPABASE_*` | Authentication only. Auto-provisioned by Lovable Cloud. |
| `EXT_SUPABASE_*` | All real data — orders, extractions, partners, commissions, batches, workspaces. This is the client's own project; treat its schema and keys accordingly. |

Almost every route that touches business data uses `EXT_SUPABASE_*`. The
plain `SUPABASE_*` project only backs login/session handling.

**Processing is driven from the browser, not a background queue by
default.** The batch page (`src/routes/_authenticated/batches.$id.tsx`)
claims and processes rows itself. If `INNGEST_EVENT_KEY` /
`INNGEST_SIGNING_KEY` are set, jobs are queued through Inngest instead and
processed by a durable worker; otherwise the app falls back to processing
directly from whichever browser tab has the batch open.

**In production, the app and the OCR service run as two containers on the
same host, joined by a shared Docker network (`orderscan-net`).** The app
reaches OCR internally at `http://ocr:8080` instead of round-tripping
through the public internet — see
[Production deployment](#production-deployment-vps--docker).

## Tech stack

- **Frontend + backend**: React + TanStack Start / TanStack Router (one
  full-stack app — `/api/*` routes and server functions live in the same
  route tree as the UI)
- **Database & auth**: Supabase (Postgres, RLS, Storage, Edge Functions)
- **OCR**: Python, FastAPI, OpenCV, PaddleOCR (PP-OCRv5 mobile) — a
  standalone microservice
- **AI extraction**: Google Gemini
- **Background jobs**: Inngest (optional — see above)
- **Email**: Resend
- **Deployment**: Docker Compose on a VPS (this repo's primary target) —
  see `ops/` in both the repo root and `ocr-service/`

## Project structure

```
src/
  routes/                  Pages (TanStack Router) + API routes (src/routes/api)
    _authenticated/         Admin panel, partner portal, batches, dashboard, reports
    api/                     extract.ts, queue-extractions.ts, health.ts, export/email endpoints
  lib/                      Business logic — commissions, payouts, billing, reconciliation,
                              extract-core.server.ts (the whole extraction routine, start here)
  components/               UI components, dashboard charts
  integrations/supabase/    Supabase clients (main + external), auth middleware
ocr-service/                Standalone FastAPI OCR microservice (own README, own ops/)
supabase/                   DB migrations + edge functions (external project)
ops/                        Deploy/rollback/health/monitor/backup scripts for the main app
docker-compose.dev.yml      Local containerized dev (hot reload)
docker-compose.prod.yml     VPS production stack (+ optional nginx/certbot "proxy" profile)
Dockerfile                  Multi-stage: dev / build / prod (Nitro node-server preset)
```

## Local development

**Prerequisites**: Node.js and npm, and access to the two Supabase
projects described above.

```sh
git clone <this-repository-url>
cd hitrotech-orderscan
npm i
cp .env.example .env    # fill in values — see Environment variables below
npm run dev
```

The terminal prints the local URL (typically `http://localhost:8080`).

Other useful scripts:

```sh
npm run build        # production build (Vercel/Cloudflare nitro preset)
npm run build:vps     # production build targeting a plain Node server (used by Dockerfile)
npm run preview       # preview a production build
npm run lint          # eslint (see note below)
npm run format        # prettier
npx tsc --noEmit       # the useful correctness check
```

> `npm run lint` is not a reliable signal here — the repo has ~1600
> pre-existing errors (CRLF line endings, `no-explicit-any`) in files
> nobody has touched. Compare against an untouched file before assuming a
> lint error is yours.

### Running the OCR service locally

The OCR service is a separate Python app with its own dev loop:

```sh
cd ocr-service
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

Then point `OCR_URL` in the main app's `.env` at
`http://localhost:8000` (or whatever `OCR_PORT` you configured).

## Environment variables

See [`.env.example`](.env.example) for the authoritative list — `.env` is
git-ignored and must never be committed. The critical ones for the
extraction pipeline to function at all:

| Variable | Purpose |
|---|---|
| `EXT_SUPABASE_URL` / `EXT_SUPABASE_SERVICE_ROLE_KEY` | Server-side admin client — creates and updates `extractions` rows. Extraction fails immediately without these. |
| `EXT_SUPABASE_PUBLISHABLE_KEY` | Used by a few request-scoped (RLS-checked) server routes. |
| `GEMINI_API_KEY` (or `LOVABLE_API_KEY` as fallback) | Structured extraction from OCR text. |
| `OCR_URL` / `OCR_API_KEY` | Where the OCR microservice lives and its shared secret. |

Everything else (`RESEND_API_KEY`, `INNGEST_*`, `APP_URL`,
`WEBHOOK_SIGNING_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) is optional — the
app degrades gracefully (no email sending, no durable queue, etc.) without
them.

`ocr-service/.env.example` documents that service's own variables
separately (`OCR_API_KEY`, `OCR_LANG`, memory/concurrency tuning knobs).

## Production deployment (VPS + Docker)

Both halves of the app — this repo's root (frontend + `/api/*` backend)
and `ocr-service/` — deploy the same way: a multi-stage `Dockerfile`, a
`docker-compose.prod.yml`, and an `ops/` folder of small, focused scripts.
They run as separate containers joined by a shared external Docker network
(`orderscan-net`) so the app can reach OCR internally.

### One-time setup on the VPS

```sh
git clone <this-repository-url> ~/hitrotech-orderscan
cd ~/hitrotech-orderscan

cp .env.example .env
nano .env                      # fill in real values
chmod 600 .env
bash ops/secrets-check.sh

cd ocr-service
cp .env.example .env
nano .env                      # OCR_API_KEY=$(openssl rand -hex 32), etc.
chmod 600 .env
bash ops/secrets-check.sh
```

### Deploy

```sh
cd ~/hitrotech-orderscan/ocr-service && bash ops/deploy.sh   # creates orderscan-net if needed
cd ~/hitrotech-orderscan && bash ops/deploy.sh
```

`ops/deploy.sh` builds the image, tags the previous `latest` as `prev`
(rollback target), starts the stack, and **automatically rolls back** if
the new container fails its health check. No domain is required to start —
the app is reachable at `http://<vps-ip>:${APP_PORT:-3000}` and OCR at
`http://<vps-ip>:${OCR_PORT:-8000}` out of the box. Once both are deployed,
set `OCR_URL=http://ocr:8080` in the root `.env` so the app talks to OCR
over the internal network instead of the public port.

### Enabling a domain + HTTPS later

1. Point the domain's DNS `A` record at the VPS IP.
2. Set `DOMAIN` and `SSL_EMAIL` in `.env` (root, and/or `ocr-service/.env`
   if it should also be reachable by domain).
3. `bash ops/deploy.sh --with-proxy` (starts nginx in front of the service).
4. `bash ops/ssl-renew.sh` (issues the cert, reloads nginx). Re-run it from
   a cron job (weekly) to keep the cert renewed — it's a no-op if the cert
   isn't due yet.

## Day-2 operations

Run any of these from the relevant directory (repo root for the app,
`ocr-service/` for OCR):

| Script | Purpose |
|---|---|
| `ops/deploy.sh [--with-proxy]` | Build + deploy, with automatic rollback on a failed health check |
| `ops/rollback.sh` | Revert to the image from the previous deploy |
| `ops/logs.sh [-n N]` | Follow (or dump) container logs |
| `ops/health.sh` | One-shot health check (used by deploy/monitor) |
| `ops/monitor.sh` | Watchdog loop — polls health, auto-restarts after N consecutive failures |
| `ops/status.sh` | Dashboard: container state, health, resource usage, disk space, recent deploys |
| `ops/backup.sh` | Back up `.env` + the running image (both services are otherwise stateless) |
| `ops/secrets-check.sh` | Validate `.env` before deploying (missing/weak keys, file permissions, git tracking) |
| `ops/cleanup.sh` | Prune old image tags, dangling images, build cache, old backups |
| `ops/migrate.sh` | Root: applies pending `supabase/migrations/*.sql` via the Supabase CLI. `ocr-service`: no-op (no database). |
| `ops/ssl-renew.sh` | Issue/renew the Let's Encrypt cert once `DOMAIN` is set |

## Troubleshooting

The UI's status badge is not enough to diagnose a stuck or failed
extraction — read the row's `error_message` column directly:

```sh
# latest rows: status, error, timing (needs EXT_SUPABASE_SERVICE_ROLE_KEY)
curl -s "$EXT_SUPABASE_URL/rest/v1/extractions?select=status,error_message,updated_at&order=updated_at.desc&limit=5" \
  -H "apikey: $EXT_SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $EXT_SUPABASE_SERVICE_ROLE_KEY"
```

The code writes a specific `error_message` for each failure mode, so this
one query almost always tells you which stage broke and why:

| Symptom in `error_message` | Cause |
|---|---|
| `OCR service not configured...` | `OCR_URL` missing on the server |
| `OCR failed: Failed to download image from storage: Object not found` | Either the upload never finished, or a Storage RLS policy is blocking the read (check `storage.objects` policies for the `screenshots` bucket) |
| `OCR failed: OCR service failed (503)` | OCR container cold-starting or resource-starved — see `ocr-service/ops/status.sh` |
| `AI error (gemini 404): ...is no longer available` | The Gemini model name in `extract-core.server.ts` has been deprecated by Google — update it to a current model |
| `AI error (... 429/402)` | Rate limit / out of credits — these are retried automatically |
| `Invalid AI response schema` | Gemini returned something that didn't parse as the expected JSON shape |
| Row stuck on "Queued" with no progress | Likely the browser tab driving processing was closed, or (no `INNGEST_*` configured) the page's client-side retry loop stalled — refresh the batch page |

Other useful checks:

```sh
# every column the extractions table actually has
curl -s "$EXT_SUPABASE_URL/rest/v1/extractions?select=*&limit=1" \
  -H "apikey: $EXT_SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $EXT_SUPABASE_SERVICE_ROLE_KEY" | jq 'keys'

# app logs
bash ops/logs.sh

# OCR service health + whether the model is loaded
curl -s "$OCR_URL/health"
```
