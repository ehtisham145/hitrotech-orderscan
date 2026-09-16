#!/usr/bin/env bash
# Measures real PaddleOCR memory/time cost inside the running orderscan-ocr
# container — the exact reproduction steps from CLAUDE.md §3, turned into a
# reusable script instead of a one-off terminal blob. Run this any time the
# paddlepaddle/paddleocr pin changes, so a version bump is measured instead
# of assumed.
#
# Usage: ops/measure-memory.sh /path/to/real-screenshot.png
#   Use a REAL screenshot, not a synthetic one — CLAUDE.md's own measurement
#   found cost tracks distinct text-line shapes, not file size, so a
#   synthetic image understates real cost.
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

IMG="${1:-}"
if [ -z "$IMG" ] || [ ! -f "$IMG" ]; then
  log_err "Usage: ops/measure-memory.sh /path/to/real-screenshot.png"
  exit 1
fi

if ! docker inspect orderscan-ocr >/dev/null 2>&1; then
  log_err "orderscan-ocr container not found — is it deployed and running?"
  exit 1
fi

log_info "Copying $IMG into the container..."
docker cp "$IMG" orderscan-ocr:/tmp/measure-test.png

echo
echo "== Installed paddlepaddle / paddleocr versions (confirms what's actually running) =="
docker exec orderscan-ocr pip show paddlepaddle paddleocr 2>/dev/null | grep -E "^(Name|Version):"

echo
echo "== Memory + timing — model load, then two inferences (checks for a leak) =="
docker exec orderscan-ocr python -c "
import time
import numpy as np
from paddleocr import PaddleOCR
from app.preprocess import preprocess

buf = open('/tmp/measure-test.png', 'rb').read()
cur = lambda: int(open('/proc/self/statm').read().split()[1]) * 4096 // 1048576

engine = PaddleOCR(
    use_angle_cls=True, lang='en', show_log=False,
    det_limit_side_len=960, rec_batch_num=6, cpu_threads=2,
)
print('MODEL_LOADED_MB', cur())

img = np.asarray(preprocess(buf))

for i in (1, 2):
    t0 = time.perf_counter()
    r = engine.ocr(img, cls=True)
    dt = time.perf_counter() - t0
    lines = len(r[0]) if r and r[0] else 0
    print(f'RUN_{i}  lines={lines}  time_s={dt:.1f}  resident_MB={cur()}')
"

echo
echo "== Container's own view (docker stats) =="
docker stats orderscan-ocr --no-stream

docker exec orderscan-ocr rm -f /tmp/measure-test.png

echo
echo "---"
echo "Compare RUN_1/RUN_2 resident_MB against CLAUDE.md §3's old baseline"
echo "(paddlepaddle 3.0.0: 587MB after load, 5920MB after one inference,"
echo "flat at ~5900MB on repeat runs). A meaningfully lower number here means"
echo "OCR_MEMORY_LIMIT and OCR_MAX_CONCURRENCY can be safely reconsidered."
