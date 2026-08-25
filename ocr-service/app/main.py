import base64
import hmac
import logging
import os
import time
from typing import Any

import numpy as np
import requests
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .preprocess import preprocess

if os.environ.get("LOG_FORMAT") == "json":
    from pythonjsonlogger import jsonlogger

    _handler = logging.StreamHandler()
    _handler.setFormatter(jsonlogger.JsonFormatter("%(asctime)s %(name)s %(levelname)s %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[_handler])
else:
    logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("orderscan-ocr")

MAX_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", 10 * 1024 * 1024))
API_KEY = os.environ.get("OCR_API_KEY", "")
OCR_LANG = os.environ.get("OCR_LANG", "en")
# On a long-lived host (VPS/container that isn't scaled to zero), eager-load at
# startup so the first real request never pays the ~15-25s model-init cost —
# that lazy first-hit is what caused intermittent 503s under Cloud Run.
EAGER_LOAD = os.environ.get("OCR_EAGER_LOAD", "true").lower() not in ("0", "false", "no")

app = FastAPI(title="OrderScan OCR", version="1.0.0")

_engine: Any = None


def get_engine() -> Any:
    """Build the PaddleOCR engine on first use (idempotent; safe if called concurrently
    since Python's GIL serializes the None-check + assign for this simple case)."""
    global _engine
    if _engine is None:
        from paddleocr import PaddleOCR

        logger.info("Loading PP-OCRv5 mobile models (lang=%s)", OCR_LANG)
        _engine = PaddleOCR(
            use_angle_cls=True,
            lang=OCR_LANG,
            show_log=False,
            det_model_dir=os.environ.get("DET_MODEL_DIR") or None,
            rec_model_dir=os.environ.get("REC_MODEL_DIR") or None,
        )
    return _engine


@app.on_event("startup")
def _warm_engine_on_startup() -> None:
    if EAGER_LOAD:
        get_engine()


def require_api_key(x_api_key: str = Header(default="")) -> None:
    if not API_KEY:
        raise HTTPException(status_code=500, detail="OCR_API_KEY is not configured")
    if not hmac.compare_digest(x_api_key, API_KEY):
        raise HTTPException(status_code=401, detail="Invalid API key")


class Base64Request(BaseModel):
    image_base64: str = Field(min_length=16)
    mime: str | None = None


class UrlRequest(BaseModel):
    image_url: str = Field(min_length=10)
    extraction_id: str | None = None


class OcrLine(BaseModel):
    text: str
    confidence: float
    box: list[list[float]]


class OcrResponse(BaseModel):
    text: str
    lines: list[OcrLine]
    confidence: float
    ms: int


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "model_loaded": _engine is not None}


async def _run_ocr(image_bytes: bytes) -> OcrResponse:
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty image payload")
    if len(image_bytes) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds size limit")

    started = time.perf_counter()
    try:
        img = preprocess(image_bytes)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    try:
        raw = get_engine().ocr(np.asarray(img), cls=True)
    except Exception as err:  # noqa: BLE001
        logger.exception("PaddleOCR failed")
        raise HTTPException(status_code=502, detail=f"OCR engine error: {err}") from err

    lines: list[OcrLine] = []
    for page in raw or []:
        for entry in page or []:
            try:
                box, (text, score) = entry[0], entry[1]
            except (TypeError, ValueError, IndexError):
                continue
            text = (text or "").strip()
            if not text:
                continue
            lines.append(
                OcrLine(
                    text=text,
                    confidence=round(float(score), 4),
                    box=[[float(x), float(y)] for x, y in box],
                )
            )

    # Reading order: top-to-bottom, then left-to-right within a ~12px band.
    lines.sort(key=lambda l: (round(min(p[1] for p in l.box) / 12), min(p[0] for p in l.box)))

    avg = round(sum(l.confidence for l in lines) / len(lines), 4) if lines else 0.0
    return OcrResponse(
        text="\n".join(l.text for l in lines),
        lines=lines,
        confidence=avg,
        ms=int((time.perf_counter() - started) * 1000),
    )


@app.post("/ocr", response_model=OcrResponse, dependencies=[Depends(require_api_key)])
async def ocr_url(payload: UrlRequest) -> OcrResponse:
    try:
        resp = requests.get(payload.image_url, timeout=10)
        resp.raise_for_status()
        return await _run_ocr(resp.content)
    except Exception as err:
        logger.error("Failed to fetch image from URL: %s", err)
        raise HTTPException(status_code=400, detail=f"Image fetch failed: {err}") from err


@app.post("/ocr/upload", response_model=OcrResponse, dependencies=[Depends(require_api_key)])
@app.post("/extract", response_model=OcrResponse, dependencies=[Depends(require_api_key)])
async def ocr_upload(file: UploadFile = File(...)) -> OcrResponse:
    """Handle multipart file uploads. Supports both /ocr/upload and /extract paths."""
    return await _run_ocr(await file.read())


@app.post("/ocr/base64", response_model=OcrResponse, dependencies=[Depends(require_api_key)])
async def ocr_base64(payload: Base64Request) -> OcrResponse:
    raw = payload.image_base64.split(",", 1)[-1]
    try:
        image_bytes = base64.b64decode(raw, validate=True)
    except Exception as err:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid base64 image") from err
    return await _run_ocr(image_bytes)
