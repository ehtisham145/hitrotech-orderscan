"""Unit tests for app/preprocess.py — pure functions, synthetic images only.

Every limit (MAX_SIDE, MIN_SIDE, MAX_MEGAPIXELS, ENABLE_*) is a module-level
constant set once from an env var at import time — changing an env var
after the module has already imported does nothing. Tests override them
with monkeypatch.setattr(preprocess, ...) instead.
"""
import numpy as np
import pytest

from app import preprocess
from tests.conftest import make_png_bytes


# --- decode() ---------------------------------------------------------------

def test_decode_valid_png_returns_array():
    img = preprocess.decode(make_png_bytes(50, 40))
    assert img is not None
    assert img.shape[0] == 40  # height
    assert img.shape[1] == 50  # width


def test_decode_corrupt_bytes_raises_value_error(corrupt_bytes):
    with pytest.raises(ValueError):
        preprocess.decode(corrupt_bytes)


def test_decode_over_megapixel_limit_raises_image_too_large(monkeypatch):
    monkeypatch.setattr(preprocess, "MAX_MEGAPIXELS", 0.001)  # ~1000px total
    with pytest.raises(preprocess.ImageTooLarge):
        preprocess.decode(make_png_bytes(200, 200))  # 0.04MP > 0.001MP limit


# --- resize() -----------------------------------------------------------

def test_resize_shrinks_when_over_max_side(monkeypatch):
    monkeypatch.setattr(preprocess, "MAX_SIDE", 100)
    monkeypatch.setattr(preprocess, "MIN_SIDE", 10)
    img = np.zeros((50, 200, 3), dtype=np.uint8)  # longest side 200 > 100
    out = preprocess.resize(img)
    assert max(out.shape[:2]) <= 100


def test_resize_grows_when_under_min_side(monkeypatch):
    monkeypatch.setattr(preprocess, "MAX_SIDE", 1000)
    monkeypatch.setattr(preprocess, "MIN_SIDE", 100)
    # Shortest side 80 -> target scale 100/80=1.25, comfortably under the 3x
    # cap (a much-smaller shortest side would hit that cap instead — see
    # test_resize_caps_upscale_at_3x below for that case).
    img = np.zeros((80, 160, 3), dtype=np.uint8)
    out = preprocess.resize(img)
    assert min(out.shape[:2]) >= 95  # allow rounding slack


def test_resize_caps_upscale_at_3x(monkeypatch):
    monkeypatch.setattr(preprocess, "MAX_SIDE", 10_000)
    monkeypatch.setattr(preprocess, "MIN_SIDE", 1000)
    img = np.zeros((10, 20, 3), dtype=np.uint8)  # shortest side 10
    out = preprocess.resize(img)
    # Without the 3x cap this would upscale toward MIN_SIDE=1000 (100x).
    assert min(out.shape[:2]) <= 31  # 10 * 3.0 = 30, plus rounding slack


def test_resize_leaves_normal_size_untouched(monkeypatch):
    monkeypatch.setattr(preprocess, "MAX_SIDE", 1000)
    monkeypatch.setattr(preprocess, "MIN_SIDE", 100)
    img = np.zeros((300, 400, 3), dtype=np.uint8)
    out = preprocess.resize(img)
    assert out is img  # identity: no resize op should have run at all


# --- denoise / enhance_contrast / deskew -------------------------------

@pytest.fixture
def sample_bgr_image() -> np.ndarray:
    # A real (non-trivial) 3-channel image so CLAHE/bilateral filter/deskew
    # all have something to actually operate on, not just zeros.
    rng = np.random.default_rng(42)
    return rng.integers(0, 255, size=(80, 80, 3), dtype=np.uint8)


def test_denoise_preserves_shape(sample_bgr_image):
    out = preprocess.denoise(sample_bgr_image)
    assert out.shape == sample_bgr_image.shape


def test_enhance_contrast_preserves_shape(sample_bgr_image):
    out = preprocess.enhance_contrast(sample_bgr_image)
    assert out.shape == sample_bgr_image.shape


def test_deskew_preserves_shape(sample_bgr_image):
    out = preprocess.deskew(sample_bgr_image)
    assert out.shape == sample_bgr_image.shape


def test_deskew_handles_blank_image():
    # An all-white image has no non-zero pixels once inverted+thresholded —
    # findNonZero returns None, and deskew must return the image unchanged
    # rather than crashing.
    blank = np.full((60, 60, 3), 255, dtype=np.uint8)
    out = preprocess.deskew(blank)
    assert out.shape == blank.shape


# --- preprocess() (full pipeline) ---------------------------------------

def test_preprocess_runs_full_pipeline(monkeypatch):
    monkeypatch.setattr(preprocess, "ENABLE_DENOISE", True)
    monkeypatch.setattr(preprocess, "ENABLE_CONTRAST", True)
    monkeypatch.setattr(preprocess, "ENABLE_DESKEW", True)
    out = preprocess.preprocess(make_png_bytes(120, 90))
    assert out is not None
    assert out.ndim == 3


def test_preprocess_skips_a_step_that_raises(monkeypatch):
    def boom(_img):
        raise RuntimeError("simulated cosmetic-step failure")

    monkeypatch.setattr(preprocess, "ENABLE_DENOISE", True)
    monkeypatch.setattr(preprocess, "ENABLE_CONTRAST", False)
    monkeypatch.setattr(preprocess, "ENABLE_DESKEW", False)
    monkeypatch.setattr(preprocess, "denoise", boom)
    # Must not raise -- a failing cosmetic step is skipped, not fatal
    # (matches the module docstring's stated contract).
    out = preprocess.preprocess(make_png_bytes(60, 60))
    assert out is not None


def _tracked(monkeypatch, name):
    """Wrap preprocess.<name> so calls to it can be counted, while keeping
    its real behavior (so the pipeline still produces a valid image)."""
    calls = []
    original = getattr(preprocess, name)

    def wrapped(img):
        calls.append(1)
        return original(img)

    monkeypatch.setattr(preprocess, name, wrapped)
    return calls


def test_preprocess_optional_steps_off_are_skipped(monkeypatch):
    denoise_calls = _tracked(monkeypatch, "denoise")
    contrast_calls = _tracked(monkeypatch, "enhance_contrast")
    deskew_calls = _tracked(monkeypatch, "deskew")
    monkeypatch.setattr(preprocess, "ENABLE_DENOISE", False)
    monkeypatch.setattr(preprocess, "ENABLE_CONTRAST", False)
    monkeypatch.setattr(preprocess, "ENABLE_DESKEW", False)

    preprocess.preprocess(make_png_bytes(60, 60))

    assert denoise_calls == []
    assert contrast_calls == []
    assert deskew_calls == []


def test_preprocess_optional_steps_on_are_called(monkeypatch):
    denoise_calls = _tracked(monkeypatch, "denoise")
    contrast_calls = _tracked(monkeypatch, "enhance_contrast")
    deskew_calls = _tracked(monkeypatch, "deskew")
    monkeypatch.setattr(preprocess, "ENABLE_DENOISE", True)
    monkeypatch.setattr(preprocess, "ENABLE_CONTRAST", True)
    monkeypatch.setattr(preprocess, "ENABLE_DESKEW", True)

    preprocess.preprocess(make_png_bytes(60, 60))

    assert len(denoise_calls) == 1
    assert len(contrast_calls) == 1
    assert len(deskew_calls) == 1


# --- encode_png() ---------------------------------------------------------

def test_encode_png_roundtrip():
    img = preprocess.decode(make_png_bytes(30, 30))
    encoded = preprocess.encode_png(img)
    assert isinstance(encoded, bytes)
    assert encoded[:8] == b"\x89PNG\r\n\x1a\n"  # PNG magic bytes
