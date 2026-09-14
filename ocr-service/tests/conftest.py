"""Shared fixtures for the ocr-service test suite.

Deliberately never imports paddleocr/paddlepaddle anywhere in this suite:
app.main.get_engine() imports PaddleOCR lazily inside its own function body,
and every test that exercises the /ocr/* routes replaces get_engine() itself
via monkeypatch, so that import line never runs during tests. No paddle
package needs to be installed to run this suite.

OCR_EAGER_LOAD must be forced off *before* `app.main` is ever imported (its
EAGER_LOAD is a module-level constant read once at import time) — otherwise
FastAPI's real startup event would call the real get_engine() during
test_main.py's `with TestClient(...)` and try to import paddleocr for real.
conftest.py is guaranteed to load before any test module, so this is the one
place that's early enough.
"""
import os

os.environ.setdefault("OCR_EAGER_LOAD", "false")

import io

import pytest
from PIL import Image


def make_png_bytes(width: int = 100, height: int = 100, color=(255, 255, 255)) -> bytes:
    """A tiny in-memory PNG — no disk fixtures, fast to generate."""
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def png_bytes() -> bytes:
    return make_png_bytes()


@pytest.fixture
def corrupt_bytes() -> bytes:
    return b"this is not an image, just garbage bytes"
