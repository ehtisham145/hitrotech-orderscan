# OrderScan OCR service

FastAPI + OpenCV + PaddleOCR **PP-OCRv5 Mobile**. Takes an image, pre-processes
it (resize → denoise → contrast → deskew), runs OCR, and returns plain text plus
per-line boxes and confidences. The main app sends the OCR text to Gemini for
structured extraction — images never go to the LLM.

```
ocr-service/
  app/main.py             FastAPI endpoints + auth
  app/preprocess.py       OpenCV pipeline
  Dockerfile               multi-stage: dev (hot reload) / prod (models baked in)
  docker-compose.dev.yml   local development
  docker-compose.prod.yml  VPS deployment (+ optional nginx/certbot "proxy" profile)
  requirements/            base.txt / dev.txt / prod.txt
  ops/                     deploy, rollback, health, monitor, backup, ssl, cleanup...
```

## Endpoints

| Method | Path          | Auth               | Body                                |
| ------ | ------------- | ------------------ | ----------------------------------- |
| GET    | `/health`     | none               | –                                   |
| POST   | `/ocr`        | `X-API-Key` header | `{ "image_url": "..." }`            |
| POST   | `/ocr/upload` | `X-API-Key` header | multipart `file`                    |
| POST   | `/ocr/base64` | `X-API-Key` header | `{ "image_base64": "...", "mime": "image/png" }` |

Response:

```json
{
  "text": "Order #12345\nCustomer John Smith\nTotal $250",
  "lines": [{ "text": "Order #12345", "confidence": 0.9871, "box": [[12,8],[210,8],[210,34],[12,34]] }],
  "confidence": 0.9712,
  "ms": 843
}
```

## Local development

```bash
cp .env.example .env   # fill in OCR_API_KEY at minimum
docker compose -f docker-compose.dev.yml up --build
```

Code under `app/` is bind-mounted, so `--reload` picks up changes without a
rebuild. Service listens on `http://localhost:${OCR_PORT:-8000}`.

## Testing

`tests/` never imports `paddleocr`/`paddlepaddle` — `get_engine()`'s import
of `PaddleOCR` is inside the function body, and every test that exercises
`/ocr/*` replaces `get_engine()` itself via `monkeypatch`, so a plain venv
with just the non-paddle packages from `requirements/dev.txt` is enough:

```bash
python -m venv .venv-test
.venv-test/Scripts/activate   # .venv-test/bin/activate on Linux/macOS
pip install fastapi==0.115.6 python-multipart==0.0.20 pydantic==2.10.4 \
  opencv-python-headless==4.10.0.84 pillow==11.0.0 numpy==1.26.4 \
  requests==2.32.3 pytest==8.3.4 pytest-asyncio==0.25.2 httpx==0.28.1
pytest -v
```

Runs in ~2s. For an authoritative check against the real dependency set
(actual paddle packages installed, matching what ships to production), run
it inside the deployed container instead — the prod image doesn't bake
`tests/` in on purpose, so copy it in for a one-off check:

```bash
docker cp ocr-service/tests orderscan-ocr:/app/tests
docker cp ocr-service/pytest.ini orderscan-ocr:/app/pytest.ini
docker exec orderscan-ocr pip install pytest==8.3.4 pytest-asyncio==0.25.2 httpx==0.28.1
docker exec -w /app orderscan-ocr python -m pytest -q
```

Also configured (in `requirements/dev.txt`) but not yet wired into any
automated pipeline: `ruff` for linting (`ruff check app/ tests/`).

## VPS deployment (Docker Compose + ops/)

One-time setup on the VPS:

```bash
git clone <this-repo>
cd hitrotech-orderscan/ocr-service
cp .env.example .env
nano .env               # set OCR_API_KEY (openssl rand -hex 32), tune limits
chmod 600 .env
bash ops/secrets-check.sh
```

Deploy:

```bash
bash ops/deploy.sh
```

This builds the `prod` image, tags the previous `latest` as `prev` (rollback
target), starts the stack, and automatically rolls back if the new container
fails its health check. No domain is required — the service is reachable at
`http://<vps-ip>:${OCR_PORT:-8000}` out of the box.

### Day-2 operations (`ops/`)

| Script                  | Purpose                                                        |
| ------------------------ | --------------------------------------------------------------- |
| `ops/deploy.sh`          | Build + deploy, with automatic rollback on a failed health check |
| `ops/rollback.sh`        | Revert to the image from the previous deploy                    |
| `ops/logs.sh [-n N]`     | Follow (or dump) container logs                                 |
| `ops/health.sh`          | One-shot `/health` check (used by deploy/monitor)                |
| `ops/monitor.sh`         | Watchdog loop: polls health, auto-restarts after N failures      |
| `ops/status.sh`          | Dashboard: container state, health, resource usage, disk space   |
| `ops/backup.sh`          | Back up `.env` + the running image (stateless service — no DB)   |
| `ops/secrets-check.sh`   | Validate `.env` before deploying (missing/weak keys, permissions)|
| `ops/cleanup.sh`         | Prune old image tags, dangling images, build cache, old backups  |
| `ops/migrate.sh`         | No-op placeholder (service has no database today)                |
| `ops/ssl-renew.sh`       | Issue/renew Let's Encrypt cert once `DOMAIN` is set (no-op until then) |

Run any of them from `ocr-service/`: `bash ops/status.sh`.

### Enabling a domain + HTTPS later

1. Point the domain's DNS `A` record at the VPS IP.
2. Set `DOMAIN` and `SSL_EMAIL` in `.env`.
3. `bash ops/deploy.sh --with-proxy` (starts nginx in front of the service).
4. `bash ops/ssl-renew.sh` (issues the cert, reloads nginx). Re-run it from a
   cron job (e.g. weekly) to keep the cert renewed.

Until then, point the main app's `OCR_URL` at `http://<vps-ip>:<port>` directly.

## Tuning

| Env var           | Default    | Purpose                                   |
| ------------------ | ---------- | ------------------------------------------ |
| `OCR_API_KEY`      | *required* | Shared secret checked on every OCR call    |
| `OCR_LANG`         | `en`       | Add `ar`, `ch`, etc. for other scripts     |
| `MAX_UPLOAD_BYTES` | `10485760` | Reject oversized images with 413           |
| `OCR_EAGER_LOAD`   | `true`     | Load the model at startup, not on first request |
| `LOG_FORMAT`       | `json`     | `json` in prod, `text` for readable dev logs |
| `UVICORN_WORKERS`  | `2`        | PaddleOCR is CPU-bound — roughly match vCPU count |
| `OCR_MEMORY_LIMIT` / `OCR_CPU_LIMIT` | `4g` / `2` | Container resource caps (see `docker-compose.prod.yml`) — leave headroom if the VPS runs other sites |

## Smoke test

```bash
source .env
curl -s "http://localhost:${OCR_PORT:-8000}/health"
curl -s -X POST "http://localhost:${OCR_PORT:-8000}/ocr/upload" \
  -H "X-API-Key: $OCR_API_KEY" -F "file=@sample.png" | jq .text
```
