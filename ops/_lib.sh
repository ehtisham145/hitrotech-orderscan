#!/usr/bin/env bash
# Shared helpers sourced by every ops/*.sh script. Not meant to be run directly.
set -euo pipefail

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$OPS_DIR/.." && pwd)"
STATE_DIR="$OPS_DIR/.state"
mkdir -p "$STATE_DIR"

IMAGE_NAME="orderscan-app"
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"
ENV_FILE="$ROOT_DIR/.env"
HEALTH_PATH="/api/health"

# ---- logging -----------------------------------------------------------
if [ -t 1 ]; then
  C_RED='\033[0;31m'; C_GRN='\033[0;32m'; C_YLW='\033[0;33m'; C_BLU='\033[0;34m'; C_OFF='\033[0m'
else
  C_RED=''; C_GRN=''; C_YLW=''; C_BLU=''; C_OFF=''
fi
log_info() { printf "${C_BLU}[info]${C_OFF} %s\n" "$*"; }
log_ok()   { printf "${C_GRN}[ ok ]${C_OFF} %s\n" "$*"; }
log_warn() { printf "${C_YLW}[warn]${C_OFF} %s\n" "$*" >&2; }
log_err()  { printf "${C_RED}[fail]${C_OFF} %s\n" "$*" >&2; }

# ---- docker compose command detection -----------------------------------
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  log_err "Neither 'docker compose' nor 'docker-compose' is available on this host."
  exit 1
fi
compose() { "${COMPOSE[@]}" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

require_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    log_err ".env not found at $ENV_FILE — copy .env.example to .env and fill it in first."
    exit 1
  fi
}

load_env() {
  require_env_file
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

port() { echo "${APP_PORT:-3000}"; }
