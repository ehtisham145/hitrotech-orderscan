# HitroTech OrderScan

OrderScan is a partner/reseller order-processing and commission-management
platform built by **HitroTech**. Users upload order screenshots or images,
which are run through OCR and AI-based structured extraction, and the
resulting order data drives partner commissions, payouts, billing, and
reporting.

## What it does

1. A user uploads an order image/screenshot (a batch of orders).
2. The image is sent to the **OCR service** (`ocr-service/`, Python +
   FastAPI + PaddleOCR), which returns plain text — the image itself is
   never sent further.
3. That text is sent to an LLM (Gemini) for **structured extraction**
   (customer, order number, amount, items, etc.).
4. Extracted data is stored in **Supabase** and used to calculate partner
   **commissions and payouts**.
5. Admins manage employees, partners, stores, billing plans, and view
   reports/reconciliation from an admin dashboard. Partners get their own
   portal to see statements and performance.

## Tech stack

- **Frontend**: React + TanStack Start / TanStack Router
- **Database & Auth**: Supabase (Postgres, RLS, Edge Functions)
- **OCR**: Python, FastAPI, OpenCV, PaddleOCR (deployed separately, e.g. on
  Cloud Run)
- **AI extraction**: Gemini
- **Background jobs**: Inngest
- **Email**: Resend

## Project structure

```
src/
  routes/            Pages (TanStack Router) + API routes (src/routes/api)
    _authenticated/   Admin panel, partner portal, batches, dashboard, reports
    api/              extract.ts, queue-extractions.ts, export/email endpoints
  lib/                Business logic (commissions, payouts, billing, reconciliation, ...)
  components/         UI components, dashboard charts
  integrations/       Supabase clients
ocr-service/          Standalone FastAPI OCR microservice
supabase/             DB migrations + edge functions
.lovable/plan/        Historical planning notes from Lovable-assisted feature work
```

## Running locally

**Prerequisites**: Node.js and npm (or Bun — `bun.lock`/`bunfig.toml` are
present) and a Supabase project.

```sh
git clone <this-repository-url>
cd hitrotech-orderscan
npm i
```

Copy the example environment file and fill in your own values (Supabase
project keys at minimum; OCR/Gemini/Resend/Inngest keys are only needed to
exercise those specific features):

```sh
cp .env.example .env
```

Then start the dev server:

```sh
npm run dev
```

The terminal will print the local URL to open in your browser.

Other useful scripts:

```sh
npm run build      # production build
npm run preview    # preview a production build
npm run lint        # eslint
npm run format      # prettier
```

### Running the OCR service (optional, for local order scanning)

The OCR service is a separate Python app. See
[`ocr-service/README.md`](ocr-service/README.md) for how to run it locally
or deploy it to Cloud Run, then point `OCR_URL` / `OCR_API_KEY` in your
`.env` at it.

## Environment variables

See [`.env.example`](.env.example) for the full list. `.env` is
git-ignored and must never be committed — it holds live Supabase, AI, and
webhook secrets.
