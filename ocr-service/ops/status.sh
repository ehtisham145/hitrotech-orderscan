#!/usr/bin/env bash
# One-shot dashboard: container state, health, resource usage, disk space.
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
load_env

echo "== Containers =="
compose ps

echo
echo "== Health =="
"$OPS_DIR/health.sh" --retries 1 || true

echo
if docker inspect orderscan-ocr >/dev/null 2>&1; then
  echo "== Image / uptime =="
  docker inspect orderscan-ocr --format 'Image:   {{.Config.Image}}'
  docker inspect orderscan-ocr --format 'Started: {{.State.StartedAt}}'
  docker inspect orderscan-ocr --format 'Status:  {{.State.Status}} (health: {{.State.Health.Status}})' 2>/dev/null || true

  echo
  echo "== Resource usage (live snapshot) =="
  docker stats --no-stream orderscan-ocr
fi

echo
echo "== Local image tags =="
docker images "$IMAGE_NAME" --format 'table {{.Tag}}\t{{.CreatedSince}}\t{{.Size}}'

echo
echo "== Disk (VPS) =="
df -h / 2>/dev/null || true

echo
echo "== Last deploys =="
tail -5 "$STATE_DIR/deploy.log" 2>/dev/null || echo "(no deploy.log yet)"
