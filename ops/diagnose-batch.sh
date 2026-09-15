#!/usr/bin/env bash
# Diagnoses a batch that looks stuck in "Queued": pulls the batch row, its
# extractions' status breakdown (flagging rows nobody has ever touched — the
# clearest signal that a worker never even started on them), recent app
# error logs, and OCR container health/memory — the combination that has
# explained every "why is nothing happening" case found on this project so
# far (see CLAUDE.md §6). Read-only; safe to run any time, no writes.
#
# curl inside orderscan-app has no CA bundle, so every Supabase query below
# runs through `docker exec orderscan-app node`, same as this project's own
# manual diagnostic commands.
#
# Usage: ops/diagnose-batch.sh [batch_id]
#   No batch_id given -> uses the most recently created batch.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
load_env

BATCH_ID="${1:-}"

echo "== 1. Batch =="
if [ -z "$BATCH_ID" ]; then
  echo "(no batch_id given — using the most recently created batch)"
  BATCH_JSON=$(docker exec orderscan-app node -e "
    const K=process.env.EXT_SUPABASE_SERVICE_ROLE_KEY, U=process.env.EXT_SUPABASE_URL;
    fetch(U+'/rest/v1/batches?select=id,name,status,created_at,processed_count,failed_count,duplicate_count&order=created_at.desc&limit=1',{headers:{apikey:K,Authorization:'Bearer '+K}})
      .then(r=>r.json()).then(j=>console.log(JSON.stringify(j[0]||{},null,2)));
  ")
else
  BATCH_JSON=$(docker exec orderscan-app node -e "
    const K=process.env.EXT_SUPABASE_SERVICE_ROLE_KEY, U=process.env.EXT_SUPABASE_URL;
    fetch(U+'/rest/v1/batches?select=id,name,status,created_at,processed_count,failed_count,duplicate_count&id=eq.$BATCH_ID',{headers:{apikey:K,Authorization:'Bearer '+K}})
      .then(r=>r.json()).then(j=>console.log(JSON.stringify(j[0]||{},null,2)));
  ")
fi
echo "$BATCH_JSON"

RESOLVED_ID=$(echo "$BATCH_JSON" | grep -o '"id": *"[^"]*"' | head -1 | sed -E 's/.*"([0-9a-fA-F-]+)"$/\1/')
if [ -z "$RESOLVED_ID" ]; then
  log_err "Could not resolve a batch id from the query above — no batches yet, or the fetch failed."
  exit 1
fi
BATCH_ID="$RESOLVED_ID"
log_info "Using batch_id=$BATCH_ID"

echo
echo "== 2. Extraction rows — status breakdown + which ones nobody has ever touched =="
docker exec orderscan-app node -e "
  const K=process.env.EXT_SUPABASE_SERVICE_ROLE_KEY, U=process.env.EXT_SUPABASE_URL;
  (async () => {
    const rows = await fetch(U+'/rest/v1/extractions?select=id,status,error_message,created_at,updated_at&batch_id=eq.$BATCH_ID&order=created_at.asc',{headers:{apikey:K,Authorization:'Bearer '+K}}).then(r=>r.json());
    const counts = {};
    let neverTouched = 0;
    for (const r of rows) {
      counts[r.status] = (counts[r.status]||0) + 1;
      if (r.created_at === r.updated_at) neverTouched++;
    }
    console.log('STATUS COUNTS:', JSON.stringify(counts));
    console.log('Rows never touched since creation (a worker never even claimed them):', neverTouched, '/', rows.length);
    console.log('');
    for (const r of rows) {
      const flag = r.created_at === r.updated_at ? ' [NEVER TOUCHED]' : '';
      console.log((r.status||'').padEnd(12), flag.padEnd(16), (r.error_message||'').slice(0,90));
    }
  })();
"

echo
echo "== 3. App container — recent errors (health-check noise filtered out) =="
docker logs orderscan-app --tail 200 2>&1 | grep -iv health | grep -iE "error|fail|deadlock|exception|429|503|timeout" | tail -30 || echo "(no matching lines in the last 200 log lines)"

echo
echo "== 4. App container — is it even running / healthy? =="
docker inspect orderscan-app --format 'Status: {{.State.Status}}  Health: {{.State.Health.Status}}  Started: {{.State.StartedAt}}' 2>/dev/null || echo "orderscan-app not found"

echo
echo "== 5. OCR container — health + memory =="
docker inspect orderscan-ocr --format 'Status: {{.State.Status}}  Health: {{.State.Health.Status}}  Started: {{.State.StartedAt}}' 2>/dev/null || echo "orderscan-ocr not found"
docker stats orderscan-ocr --no-stream 2>/dev/null || true

echo
echo "== 6. Was anything OOM-killed recently? =="
sudo dmesg -T 2>/dev/null | grep -i "killed process" | tail -5 || echo "(dmesg not available, or nothing found)"

echo
echo "== 7. Host memory =="
free -h

echo
echo "---"
echo "Read section 2 first: if 'NEVER TOUCHED' is high, no worker ever"
echo "claimed these rows — usually means the batch page tab wasn't open"
echo "long enough, or the batch itself is paused/cancelled. If rows instead"
echo "show an error_message, that message is the real cause."
