# syntax=docker/dockerfile:1
#
# Multi-stage build for the TanStack Start app (frontend + /api/* server
# functions — it's a single full-stack process, not a separate front/back).
# Uses node:*-slim (glibc) rather than alpine: several deps (heic-to,
# pdfjs-dist, xlsx) ship native/WASM binaries that are safer on glibc.

FROM node:24-slim AS base
WORKDIR /app
ENV PORT=8080
EXPOSE 8080

# ---------------------------------------------------------------------------
# deps: install once, reused by both the dev and build stages.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# dev: source is bind-mounted over this in docker-compose.dev.yml.
# ---------------------------------------------------------------------------
FROM deps AS dev
ENV NODE_ENV=development
COPY . .
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "8080"]

# ---------------------------------------------------------------------------
# build: produces the self-contained Nitro `.output/` (node-server preset —
# see vite.config.ts and package.json's build:vps script).
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
ENV NITRO_PRESET=node-server
RUN npm run build:vps

# ---------------------------------------------------------------------------
# prod: no source, no node_modules from the build stage — Nitro's output is
# self-contained. Smallest reasonable runtime image.
# ---------------------------------------------------------------------------
FROM node:24-slim AS prod
WORKDIR /app
ENV NODE_ENV=production PORT=8080

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/.output ./.output

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8080/api/health || exit 1

CMD ["node", ".output/server/index.mjs"]
