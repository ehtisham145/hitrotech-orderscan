#!/usr/bin/env bash
# Usage: ops/health.sh [--retries N] [--interval SECONDS] [--quiet]
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
load_env

retries=1
interval=3
quiet=0
while [ $# -gt 0 ]; do
  case "$1" in
    --retries) retries="$2"; shift 2 ;;
    --interval) interval="$2"; shift 2 ;;
    --quiet) quiet=1; shift ;;
    *) log_err "Unknown flag: $1"; exit 2 ;;
  esac
done

url="http://localhost:$(port)$HEALTH_PATH"
attempt=1
while [ "$attempt" -le "$retries" ]; do
  if body="$(curl -fsS --max-time 5 "$url" 2>/dev/null)"; then
    [ "$quiet" -eq 1 ] || log_ok "Healthy ($url): $body"
    exit 0
  fi
  [ "$quiet" -eq 1 ] || log_warn "Attempt $attempt/$retries: $url not responding yet"
  attempt=$((attempt + 1))
  [ "$attempt" -le "$retries" ] && sleep "$interval"
done

[ "$quiet" -eq 1 ] || log_err "Service did not become healthy after $retries attempt(s): $url"
exit 1
