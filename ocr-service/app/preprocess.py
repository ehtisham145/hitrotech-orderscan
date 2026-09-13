"""Image pre-processing pipeline run before PaddleOCR.

Order: decode -> resize -> denoise -> contrast -> deskew.
Every cosmetic step is defensive: if one fails we fall back to the previous
image so a bad input never takes the whole request down. Decoding is the
exception — an image we cannot bound is refused rather than processed.
"""

from __future__ import annotations

import os
from io import BytesIO

import cv2
import numpy as np
from PIL import Image

# Lower this (e.g. to 960) on a memory-constrained host — detection memory
# scales with pixel count, and a smaller canvas costs real accuracy only on
# already-small source text, not on a normal phone screenshot.
MAX_SIDE = int(os.environ.get("OCR_MAX_SIDE", "1280"))
MIN_SIDE = 640

# Inference memory tracks decoded pixels, not file bytes: a compact PNG can open
# into a canvas far larger than anything worth reading, and the byte-size limit
# in main.py says nothing about that.
MAX_MEGAPIXELS = float(os.environ.get("OCR_MAX_MEGAPIXELS", "25"))


def _flag(name: str, default: str = "true") -> bool:
    return os.environ.get(name, default).lower() not in ("0", "false", "no")


# Screenshots arrive clean, so the steps meant for noisy scans mostly cost time.
# Toggled rather than deleted: they still earn their place on photographed
# receipts, and turning one off is a config change, not a rebuild.
ENABLE_DENOISE = _flag("OCR_DENOISE")
ENABLE_CONTRAST = _flag("OCR_CONTRAST")
ENABLE_DESKEW = _flag("OCR_DESKEW")


class ImageTooLarge(ValueError):
    """Decoded dimensions exceed what this service will process."""


def _reduced_read_flag(longest_side: int) -> int:
    """Pick a decode-time reduction so we never materialise more than we need.

    cv2 can decode JPEG/PNG at 1/2, 1/4 or 1/8 scale directly, which costs a
    fraction of the memory of decoding in full and then resizing down.
    """
    for factor, flag in (
        (8, cv2.IMREAD_REDUCED_COLOR_8),
        (4, cv2.IMREAD_REDUCED_COLOR_4),
        (2, cv2.IMREAD_REDUCED_COLOR_2),
    ):
        if longest_side / factor >= MAX_SIDE:
            return flag
    return cv2.IMREAD_COLOR


def decode(image_bytes: bytes) -> np.ndarray:
    try:
        # Reads the header only — dimensions without paying for the pixels.
        with Image.open(BytesIO(image_bytes)) as probe:
            width, height = probe.size
    except Exception as err:  # noqa: BLE001 - any failure here means "not an image"
        raise ValueError("Unsupported or corrupt image data") from err

    megapixels = (width * height) / 1_000_000
    if megapixels > MAX_MEGAPIXELS:
        raise ImageTooLarge(
            f"Image is {megapixels:.1f}MP, over the {MAX_MEGAPIXELS:.0f}MP limit"
        )

    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, _reduced_read_flag(max(width, height)))
    if img is None:
        raise ValueError("Unsupported or corrupt image data")
    return img


def resize(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    longest = max(h, w)
    shortest = min(h, w)

    if longest > MAX_SIDE:
        scale = MAX_SIDE / longest
    elif shortest < MIN_SIDE:
        # Cap the upscale against MAX_SIDE too: without it a thin strip (short
        # side well under MIN_SIDE) grows past the ceiling the branch above
        # exists to enforce.
        scale = min(MIN_SIDE / shortest, 3.0, MAX_SIDE / longest)
    else:
        return img

    if abs(scale - 1.0) < 1e-3:
        return img

    return cv2.resize(
        img,
        (max(1, int(w * scale)), max(1, int(h * scale))),
        interpolation=cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA,
    )


def denoise(img: np.ndarray) -> np.ndarray:
    # Bilateral keeps glyph edges sharp while flattening JPEG/screenshot noise.
    return cv2.bilateralFilter(img, d=5, sigmaColor=50, sigmaSpace=50)


def enhance_contrast(img: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return cv2.cvtColor(cv2.merge((clahe.apply(l), a, b)), cv2.COLOR_LAB2BGR)


def deskew(img: np.ndarray) -> np.ndarray:
    """Correct small rotations (< 15 deg) using the minimum-area text box."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.bitwise_not(gray)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    coords = cv2.findNonZero(thresh)
    if coords is None:
        return img

    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = 90 + angle
    if abs(angle) < 0.3 or abs(angle) > 15:
        return img

    h, w = img.shape[:2]
    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(
        img, matrix, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )


def preprocess(image_bytes: bytes) -> np.ndarray:
    img = decode(image_bytes)

    steps = [resize]
    if ENABLE_DENOISE:
        steps.append(denoise)
    if ENABLE_CONTRAST:
        steps.append(enhance_contrast)
    if ENABLE_DESKEW:
        steps.append(deskew)

    for step in steps:
        try:
            img = step(img)
        except Exception:  # noqa: BLE001 - never fail the request on a cosmetic step
            continue
    return img


def encode_png(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise ValueError("Failed to encode processed image")
    return buf.tobytes()
