#!/usr/bin/env bash
# Build + deploy the prod stack. Automatically rolls back if the new
# container fails its health check.
#
# Usage: ops/deploy.sh [--with-proxy] [--no-rollback]
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

with_proxy=0
auto_rollback=1
while [ $# -gt 0 ]; do
  case "$1" in
    --with-proxy) with_proxy=1; shift ;;
    --no-rollback) auto_rollback=0; shift ;;
    *) log_err "Unknown flag: $1"; exit 2 ;;
  esac
done

profile_args=()
[ "$with_proxy" -eq 1 ] && profile_args=(--profile proxy)

log_info "Running secrets-check..."
"$OPS_DIR/secrets-check.sh"

# Shared network with the main app's stack (see docker-compose.prod.yml).
# Idempotent — whichever service deploys first creates it.
docker network inspect orderscan-net >/dev/null 2>&1 || docker network create orderscan-net

# Preserve the currently-running image as the rollback target *before*
# building the new one, so a failed deploy can always go back one step.
if docker image inspect "$IMAGE_NAME:latest" >/dev/null 2>&1; then
  docker tag "$IMAGE_NAME:latest" "$IMAGE_NAME:prev"
  log_info "Tagged current image as $IMAGE_NAME:prev (rollback target)"
fi

timestamp="$(date -u +%Y%m%d-%H%M%S)"
log_info "Building $IMAGE_NAME:$timestamp ..."
IMAGE_TAG="$timestamp" compose "${profile_args[@]}" build ocr

docker tag "$IMAGE_NAME:$timestamp" "$IMAGE_NAME:latest"

log_info "Starting containers..."
IMAGE_TAG="latest" compose "${profile_args[@]}" up -d --remove-orphans

log_info "Waiting for health check..."
if "$OPS_DIR/health.sh" --retries 20 --interval 3; then
  echo "$timestamp" >> "$STATE_DIR/deploy.log"
  log_ok "Deploy succeeded — image $IMAGE_NAME:$timestamp is live"
  exit 0
fi

log_err "New deployment failed its health check."
if [ "$auto_rollback" -eq 1 ] && docker image inspect "$IMAGE_NAME:prev" >/dev/null 2>&1; then
  log_warn "Rolling back automatically (pass --no-rollback to disable this)..."
  "$OPS_DIR/rollback.sh"
  exit 1
fi
log_err "Not rolling back. Container is left running — inspect with: bash ops/logs.sh"
exit 1
