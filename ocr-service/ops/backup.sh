#!/usr/bin/env bash
# This service is stateless (no DB, no persistent volumes — OCR models are
# baked into the image). "Backup" here means: the running config (.env) and
# a portable copy of the exact image currently in production, so a fresh VPS
# can be brought back up without rebuilding from source.
#
# Usage: ops/backup.sh [--keep N]
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_env_file

keep=5
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) keep="$2"; shift 2 ;;
    *) log_err "Unknown flag: $1"; exit 2 ;;
  esac
done

backups_dir="$ROOT_DIR/backups"
ts="$(date -u +%Y%m%d-%H%M%S)"
dest="$backups_dir/$ts"
mkdir -p "$dest"

log_info "Backing up .env..."
install -m 600 "$ENV_FILE" "$dest/.env"

if docker image inspect "$IMAGE_NAME:latest" >/dev/null 2>&1; then
  log_info "Exporting $IMAGE_NAME:latest (this can take a minute)..."
  docker save "$IMAGE_NAME:latest" | gzip -1 > "$dest/image.tar.gz"
else
  log_warn "No $IMAGE_NAME:latest image found — skipping image export."
fi

{
  echo "created_at=$ts"
  echo "image=$IMAGE_NAME:latest"
  git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null | sed 's/^/git_commit=/' || echo "git_commit=unknown"
} > "$dest/manifest.txt"

log_ok "Backup written to $dest"

# Retention: keep the newest $keep backups.
mapfile -t old < <(ls -1dt "$backups_dir"/*/ 2>/dev/null | tail -n +$((keep + 1)))
for d in "${old[@]:-}"; do
  [ -n "$d" ] || continue
  log_info "Pruning old backup: $d"
  rm -rf "$d"
done
