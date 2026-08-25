"""Image pre-processing pipeline run before PaddleOCR.

Order: decode -> resize -> denoise -> contrast -> deskew.
Every step is defensive: if a step fails we fall back to the previous image so
a bad input never takes the whole request down.
"""

from __future__ import annotations

import cv2
import numpy as np

MAX_SIDE = 1280
MIN_SIDE = 640


def decode(image_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
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
        scale = min(MIN_SIDE / shortest, 3.0)
    else:
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
    for step in (resize, denoise, enhance_contrast, deskew):
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
