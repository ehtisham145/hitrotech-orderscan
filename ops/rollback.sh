#!/usr/bin/env bash
# Reverts to the image tagged during the previous deploy.sh run.
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

if ! docker image inspect "$IMAGE_NAME:prev" >/dev/null 2>&1; then
  log_err "No $IMAGE_NAME:prev image found — nothing to roll back to."
  log_err "(A rollback target is only recorded once ops/deploy.sh has run at least twice.)"
  exit 1
fi

log_warn "Rolling back $IMAGE_NAME:latest -> $IMAGE_NAME:prev"
docker tag "$IMAGE_NAME:prev" "$IMAGE_NAME:latest"

IMAGE_TAG="latest" compose up -d --force-recreate app

log_info "Waiting for health check..."
if "$OPS_DIR/health.sh" --retries 15 --interval 3; then
  log_ok "Rollback succeeded"
  exit 0
fi

log_err "Rollback deployed but the app still isn't healthy — check: bash ops/logs.sh"
exit 1
