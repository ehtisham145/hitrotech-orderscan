# syntax=docker/dockerfile:1

FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/app \
    PORT=8080

# OpenCV + PaddleOCR runtime libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    ccache \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
EXPOSE 8080

# ---------------------------------------------------------------------------
# dev: bind-mounts ./app over this layer (see docker-compose.dev.yml), so the
# COPY of app/ here only matters for `docker run` without compose.
# ---------------------------------------------------------------------------
FROM base AS dev

COPY requirements/base.txt requirements/dev.txt requirements/
RUN pip install --upgrade pip && pip install -r requirements/dev.txt

COPY app ./app

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--reload"]

# ---------------------------------------------------------------------------
# prod: no bind mount, no dev tooling, models baked in at build time so the
# very first request after container start doesn't pay a download cost.
# ---------------------------------------------------------------------------
FROM base AS prod

COPY requirements/base.txt requirements/prod.txt requirements/
RUN pip install --upgrade pip && pip install -r requirements/prod.txt

COPY app ./app

# Warm the model cache into the image (download only; the process-level engine
# is still built lazily/at-startup by app.main, see OCR_EAGER_LOAD).
RUN python -c "from paddleocr import PaddleOCR; PaddleOCR(use_angle_cls=True, lang='en', show_log=False)"

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD curl -fsS http://localhost:8080/health || exit 1

CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} \
    --workers ${UVICORN_WORKERS:-2} --timeout-keep-alive 65
