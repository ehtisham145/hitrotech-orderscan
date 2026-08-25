#!/usr/bin/env bash
# Deploys both halves of the stack in the order they depend on each other:
# ocr-service first (it creates the shared orderscan-net network the app joins),
# then the app. Each half is still independently deployable via its own
# ops/deploy.sh — reach for this only when a change spans both.
#
# Any arguments are forwarded to both underlying deploy scripts, so e.g.
#   ops/deploy-all.sh --no-rollback
# behaves the same as passing that flag to each one.
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

OCR_DIR="$ROOT_DIR/ocr-service"

if [ ! -x "$OCR_DIR/ops/deploy.sh" ] && [ ! -f "$OCR_DIR/ops/deploy.sh" ]; then
  log_err "No ocr-service/ops/deploy.sh found at $OCR_DIR — deploy this half on its own."
  exit 1
fi

log_info "1/2 Deploying ocr-service..."
( cd "$OCR_DIR" && bash ops/deploy.sh "$@" )

log_info "2/2 Deploying app..."
( cd "$ROOT_DIR" && bash ops/deploy.sh "$@" )

log_ok "Both services deployed."
