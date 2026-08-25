#!/usr/bin/env bash
# Reclaims disk space: old timestamped images beyond --keep, dangling images,
# stale build cache, an oversized monitor log, and backups beyond retention.
#
# Usage: ops/cleanup.sh [--keep N]
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

keep=3
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) keep="$2"; shift 2 ;;
    *) log_err "Unknown flag: $1"; exit 2 ;;
  esac
done

log_info "Pruning timestamped $IMAGE_NAME images beyond the last $keep (keeping 'latest' and 'prev')..."
mapfile -t tags < <(docker images "$IMAGE_NAME" --format '{{.Tag}}' | grep -E '^[0-9]{8}-[0-9]{6}$' | sort -r)
for tag in "${tags[@]:$keep}"; do
  log_info "Removing $IMAGE_NAME:$tag"
  docker rmi "$IMAGE_NAME:$tag" >/dev/null 2>&1 || log_warn "Could not remove $IMAGE_NAME:$tag (may still be referenced)"
done

log_info "Pruning dangling images..."
docker image prune -f >/dev/null

log_info "Pruning build cache older than 72h..."
docker builder prune -f --filter until=72h >/dev/null 2>&1 || true

if [ -f "$STATE_DIR/monitor.log" ]; then
  size_kb=$(du -k "$STATE_DIR/monitor.log" | cut -f1)
  if [ "$size_kb" -gt 20480 ]; then
    log_info "monitor.log is ${size_kb}KB — rotating."
    mv "$STATE_DIR/monitor.log" "$STATE_DIR/monitor.log.$(date -u +%Y%m%d)"
    gzip -f "$STATE_DIR/monitor.log."* 2>/dev/null || true
  fi
fi

if [ -d "$ROOT_DIR/backups" ]; then
  log_info "Applying backup retention (keep last 5)..."
  mapfile -t old < <(ls -1dt "$ROOT_DIR/backups"/*/ 2>/dev/null | tail -n +6)
  for d in "${old[@]:-}"; do
    [ -n "$d" ] || continue
    log_info "Removing old backup: $d"
    rm -rf "$d"
  done
fi

log_ok "Cleanup done."
docker system df
