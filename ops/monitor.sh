#!/usr/bin/env bash
# Watchdog: polls /api/health on an interval; after N consecutive failures it
# restarts the container and logs an alert. Runs in the foreground — start it
# under systemd, tmux, `nohup ... &`, or a cron @reboot line.
#
# Usage: ops/monitor.sh [--interval SECONDS] [--fail-threshold N] [--once]
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

interval=30
threshold=3
once=0
while [ $# -gt 0 ]; do
  case "$1" in
    --interval) interval="$2"; shift 2 ;;
    --fail-threshold) threshold="$2"; shift 2 ;;
    --once) once=1; shift ;;
    *) log_err "Unknown flag: $1"; exit 2 ;;
  esac
done

log_file="$STATE_DIR/monitor.log"
fail_count=0

check_once() {
  local ts stats
  ts="$(date -u +%FT%TZ)"
  if "$OPS_DIR/health.sh" --retries 1 --quiet; then
    fail_count=0
    stats="$(docker stats --no-stream --format '{{.CPUPerc}} {{.MemUsage}}' orderscan-app 2>/dev/null || echo 'n/a')"
    echo "$ts ok  cpu/mem=$stats" >>"$log_file"
  else
    fail_count=$((fail_count + 1))
    echo "$ts FAIL consecutive=$fail_count" >>"$log_file"
    log_warn "Health check failed ($fail_count/$threshold)"
    if [ "$fail_count" -ge "$threshold" ]; then
      log_err "Threshold reached — restarting orderscan-app"
      echo "$ts RESTART" >>"$log_file"
      compose restart app || true
      fail_count=0
    fi
  fi
}

if [ "$once" -eq 1 ]; then
  check_once
  exit 0
fi

log_info "Monitoring every ${interval}s (fail-threshold=$threshold). Logging to $log_file. Ctrl+C to stop."
trap 'log_info "Stopping monitor."; exit 0' INT TERM
while true; do
  check_once
  sleep "$interval"
done
