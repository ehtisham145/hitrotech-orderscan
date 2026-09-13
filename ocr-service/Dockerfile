# syntax=docker/dockerfile:1

FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/app \
    PORT=8080 \
    # Paddle/OpenCV pull in OpenMP + MKL, which size their thread pools (and the
    # per-thread scratch buffers that dominate this container's memory) from the
    # host's core count rather than the container's CPU share. Pin them so a
    # single request can't fan out past the CPUs this service actually has.
    OMP_NUM_THREADS=2 \
    MKL_NUM_THREADS=2 \
    OPENBLAS_NUM_THREADS=2 \
    FLAGS_allocator_strategy=auto_growth

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
# prod: no bind mount, no dev tooling. Models are NOT baked in at build time
# (see below) — they download on first container start instead, via
# app.main's OCR_EAGER_LOAD path.
# ---------------------------------------------------------------------------
FROM base AS prod

COPY requirements/base.txt requirements/prod.txt requirements/
RUN pip install --upgrade pip && pip install -r requirements/prod.txt

COPY app ./app

# Deliberately NOT running the model-prebake step here (previously:
# `python -c "from paddleocr import PaddleOCR; PaddleOCR(...)"` at build
# time). On this project's VPS that step reproducibly corrupted mid-build
# (`zlib.error: Error -2 while decompressing data: inconsistent stream
# state` inside pip's/paddle's own download-and-unpack, not this repo's
# code) even after `--no-cache` and a full `docker builder prune -af`. The
# cost is a slower first request after a fresh container start (model
# download + load) instead of a slower image build; correctness is
# unaffected either way.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD curl -fsS http://localhost:8080/health || exit 1

CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} \
    --workers ${UVICORN_WORKERS:-2} --timeout-keep-alive 65
