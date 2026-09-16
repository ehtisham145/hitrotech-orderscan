"""Integration tests for app/main.py's FastAPI routes.

Uses starlette's synchronous TestClient (httpx-based, already a transitive
dependency via fastapi) so every route — despite being `async def` — runs
correctly without pytest-asyncio or any async test function.

PaddleOCR is never actually loaded: get_engine()'s `from paddleocr import
PaddleOCR` import is inside the function body, so replacing the whole
app.main.get_engine function (rather than mocking the PaddleOCR class)
means that import line never executes here — no paddle package needs to be
installed to run this file.
"""
import threading

import pytest
from fastapi.testclient import TestClient

from app import main
from tests.conftest import make_png_bytes

API_KEY = "test-api-key-for-pytest"


@pytest.fixture(autouse=True)
def valid_api_key(monkeypatch):
    """Every test gets a known-good key by default; the auth-negative tests
    below override main.API_KEY themselves for their specific case."""
    monkeypatch.setattr(main, "API_KEY", API_KEY)


@pytest.fixture(scope="session")
def client():
    # Session-scoped, and entered as a context manager, deliberately:
    # app.main._inference_slot is a module-level asyncio.Semaphore created
    # once at import time, and asyncio's synchronization primitives bind to
    # whichever event loop first awaits them. TestClient runs the ASGI app
    # through its own dedicated loop (a "portal") that's only kept alive for
    # the duration of the `with` block — used bare (no `with`), each request
    # gets its own transient portal/loop, and the *second* request to touch
    # the semaphore hits "bound to a different event loop" since it was
    # already bound by the first. One shared, context-managed client for the
    # whole session keeps every request on the same loop, matching how the
    # real service actually runs (one process, one loop, one semaphore for
    # its lifetime). This also runs the real startup/shutdown lifespan
    # events, which is why conftest.py forces OCR_EAGER_LOAD off first.
    with TestClient(main.app) as c:
        yield c


def _auth():
    return {"X-API-Key": API_KEY}


def _fake_ocr_result(lines=None):
    """Shape PaddleOCR's real .ocr() return value: a list of one page, each
    a list of [box, (text, score)] entries."""
    if lines is None:
        lines = [("Order Number", 0.98), ("CXO-ABC123", 0.95)]
    page = []
    y = 10
    for text, score in lines:
        box = [[10.0, float(y)], [100.0, float(y)], [100.0, float(y + 20)], [10.0, float(y + 20)]]
        page.append([box, (text, score)])
        y += 30
    return [page]


@pytest.fixture
def mock_engine(monkeypatch):
    """Replaces get_engine() entirely — PaddleOCR is never imported."""
    calls = []

    class FakeEngine:
        def ocr(self, _img, cls=True):
            calls.append(1)
            return _fake_ocr_result()

    monkeypatch.setattr(main, "get_engine", lambda: FakeEngine())
    return calls


# --- /health ----------------------------------------------------------------

def test_health_ok(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


# --- require_api_key ---------------------------------------------------------

def test_missing_api_key_is_401(client, mock_engine):
    res = client.post("/ocr/upload", files={"file": ("t.png", make_png_bytes(), "image/png")})
    assert res.status_code == 401


def test_wrong_api_key_is_401(client, mock_engine):
    res = client.post(
        "/ocr/upload",
        files={"file": ("t.png", make_png_bytes(), "image/png")},
        headers={"X-API-Key": "wrong-key"},
    )
    assert res.status_code == 401


def test_unconfigured_api_key_is_500(client, monkeypatch, mock_engine):
    monkeypatch.setattr(main, "API_KEY", "")
    res = client.post(
        "/ocr/upload",
        files={"file": ("t.png", make_png_bytes(), "image/png")},
        headers={"X-API-Key": "anything"},
    )
    assert res.status_code == 500


# --- /ocr/upload --------------------------------------------------------

def test_upload_empty_file_is_400(client, mock_engine):
    res = client.post("/ocr/upload", files={"file": ("t.png", b"", "image/png")}, headers=_auth())
    assert res.status_code == 400


def test_upload_oversized_file_is_413(client, monkeypatch, mock_engine):
    monkeypatch.setattr(main, "MAX_BYTES", 10)
    res = client.post(
        "/ocr/upload",
        files={"file": ("t.png", make_png_bytes(50, 50), "image/png")},
        headers=_auth(),
    )
    assert res.status_code == 413


def test_upload_corrupt_image_is_400(client, mock_engine):
    res = client.post(
        "/ocr/upload",
        files={"file": ("t.png", b"not an image", "image/png")},
        headers=_auth(),
    )
    assert res.status_code == 400


def test_upload_valid_image_returns_expected_shape(client, mock_engine):
    res = client.post(
        "/ocr/upload",
        files={"file": ("t.png", make_png_bytes(200, 150), "image/png")},
        headers=_auth(),
    )
    assert res.status_code == 200
    body = res.json()
    assert "Order Number" in body["text"]
    assert "CXO-ABC123" in body["text"]
    assert len(body["lines"]) == 2
    assert 0 <= body["confidence"] <= 1
    assert body["ms"] >= 0
    assert len(mock_engine) == 1  # confirms the mocked engine was actually invoked


def test_upload_megapixel_limit_is_413(client, monkeypatch, mock_engine):
    monkeypatch.setattr("app.preprocess.MAX_MEGAPIXELS", 0.001)
    res = client.post(
        "/ocr/upload",
        files={"file": ("t.png", make_png_bytes(200, 200), "image/png")},
        headers=_auth(),
    )
    assert res.status_code == 413


# --- /extract (same handler as /ocr/upload, different path) -----------------

def test_extract_alias_also_works(client, mock_engine):
    res = client.post(
        "/extract",
        files={"file": ("t.png", make_png_bytes(50, 50), "image/png")},
        headers=_auth(),
    )
    assert res.status_code == 200


# --- concurrency guard --------------------------------------------------
#
# Both tests use a real background thread + threading.Event, not sleeps, to
# deterministically hold the single inference slot open for a controlled
# window — this exercises the actual semaphore via normal request handling
# instead of poking asyncio.Semaphore internals directly, which would risk
# binding to the wrong event loop across TestClient's own loop management.

def _slow_engine(started: threading.Event, release: threading.Event):
    class SlowFakeEngine:
        def ocr(self, _img, cls=True):
            started.set()
            release.wait(timeout=5)
            return _fake_ocr_result()

    return SlowFakeEngine()


def test_fail_fast_returns_503_when_slot_busy(client, monkeypatch):
    monkeypatch.setattr(main, "OCR_FAIL_FAST", True)
    started = threading.Event()
    release = threading.Event()
    monkeypatch.setattr(main, "get_engine", lambda: _slow_engine(started, release))

    first_result = {}

    def make_first_request():
        first_result["res"] = client.post(
            "/ocr/upload",
            files={"file": ("t.png", make_png_bytes(50, 50), "image/png")},
            headers=_auth(),
        )

    t1 = threading.Thread(target=make_first_request)
    t1.start()
    assert started.wait(timeout=5), "first request never reached the engine"

    # The single slot is now held by the first request's in-flight OCR call.
    second_res = client.post(
        "/ocr/upload",
        files={"file": ("t.png", make_png_bytes(50, 50), "image/png")},
        headers=_auth(),
    )
    assert second_res.status_code == 503

    release.set()
    t1.join(timeout=5)
    assert first_result["res"].status_code == 200


def test_non_fail_fast_second_request_queues_instead_of_503(client, monkeypatch):
    monkeypatch.setattr(main, "OCR_FAIL_FAST", False)
    started = threading.Event()
    release = threading.Event()
    monkeypatch.setattr(main, "get_engine", lambda: _slow_engine(started, release))

    results = {}

    def make_request(key):
        results[key] = client.post(
            "/ocr/upload",
            files={"file": ("t.png", make_png_bytes(50, 50), "image/png")},
            headers=_auth(),
        )

    t1 = threading.Thread(target=make_request, args=("first",))
    t1.start()
    assert started.wait(timeout=5), "first request never reached the engine"

    t2 = threading.Thread(target=make_request, args=("second",))
    t2.start()
    # Not a correctness wait (release.set() below is) -- just enough of a
    # head start for the second request to reach and block on the busy
    # slot before we assert it's still waiting rather than already done.
    t2_reached_wait = not t2.join(timeout=0.2)
    assert t2_reached_wait, "second request should still be queued on the busy slot"

    release.set()
    t1.join(timeout=5)
    t2.join(timeout=5)

    assert results["first"].status_code == 200
    assert results["second"].status_code == 200
