#!/usr/bin/env bash
# Usage: ops/logs.sh [-n LINES] [-f|--no-follow] [service]
# Defaults to following the ocr service's logs, last 200 lines.
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

lines=200
follow=1
service="ocr"
while [ $# -gt 0 ]; do
  case "$1" in
    -n) lines="$2"; shift 2 ;;
    --no-follow) follow=0; shift ;;
    -f) follow=1; shift ;;
    *) service="$1"; shift ;;
  esac
done

args=(logs --tail "$lines")
[ "$follow" -eq 1 ] && args+=(-f)
args+=("$service")

compose "${args[@]}"
