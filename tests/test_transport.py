"""Cached JSON transport HTTP behavior."""

import httpx
import pytest

from rugby_data.cache import ApiCache
from rugby_data.rims_api import RimsApi
from rugby_data.transport import ActivityTracker, CachedJsonTransport

URL = "https://example.test/resource"


def make_transport(tmp_path, handler, *, retries=2, delays: list[int]):
    return CachedJsonTransport(
        ApiCache(tmp_path / "cache.json"),
        ActivityTracker(),
        lambda _url: "resource",
        headers={"User-Agent": "test-agent"},
        retries=retries,
        timeout=7,
        retry_delay=lambda _error, attempt: delays.append(attempt) or 0,
        client=httpx.Client(
            headers={"User-Agent": "test-agent"},
            transport=httpx.MockTransport(handler),
        ),
    )


def test_cache_hit_skips_http_request(tmp_path):
    requests = 0

    def handler(_request):
        nonlocal requests
        requests += 1
        return httpx.Response(200, json={"network": True})

    transport = make_transport(tmp_path, handler, delays=[])
    transport._cache.put(URL, {"cached": True})

    assert transport.get(URL) == {"cached": True}
    assert requests == 0
    assert transport._activity.snapshot() == ("idle", 0)


def test_success_uses_configured_headers_and_caches_response(tmp_path):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"ok": True})

    transport = make_transport(tmp_path, handler, delays=[])

    assert transport.get(URL) == {"ok": True}
    assert requests[0].headers["User-Agent"] == "test-agent"
    assert transport._cache.get(URL) == {"ok": True}
    assert transport._activity.snapshot() == ("resource", 1)


def test_owned_client_uses_configured_headers_and_timeout(tmp_path):
    transport = CachedJsonTransport(
        ApiCache(tmp_path / "cache.json"),
        ActivityTracker(),
        lambda _url: "resource",
        headers={"User-Agent": "test-agent"},
        retries=1,
        timeout=7,
    )

    try:
        assert transport._client.headers["User-Agent"] == "test-agent"
        assert transport._client.timeout.connect == 7
    finally:
        transport.close()


def test_retries_connect_error_then_succeeds(tmp_path):
    attempts = 0

    def handler(request):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise httpx.ConnectError("offline", request=request)
        return httpx.Response(200, json={"ok": True})

    transport = make_transport(tmp_path, handler, delays=[])

    assert transport.get(URL) == {"ok": True}
    assert attempts == 2


def test_close_closes_owned_client(tmp_path):
    transport = CachedJsonTransport(
        ApiCache(tmp_path / "cache.json"),
        ActivityTracker(),
        lambda _url: "resource",
        headers={"User-Agent": "test-agent"},
        retries=1,
        timeout=7,
    )

    transport.close()

    assert transport._client.is_closed


def test_close_does_not_close_injected_client(tmp_path):
    client = httpx.Client()
    transport = CachedJsonTransport(
        ApiCache(tmp_path / "cache.json"),
        ActivityTracker(),
        lambda _url: "resource",
        headers={"User-Agent": "test-agent"},
        retries=1,
        timeout=7,
        client=client,
    )

    transport.close()

    assert not client.is_closed
    client.close()


def test_rims_429_retry_delay_uses_http_status_code(tmp_path):
    response = httpx.Response(429, request=httpx.Request("GET", URL))
    error = httpx.HTTPStatusError(
        "rate limited", request=response.request, response=response
    )
    api = RimsApi(ApiCache(tmp_path / "cache.json"))

    try:
        assert api._retry_delay(error, 1) == 10
    finally:
        api.close()


@pytest.mark.parametrize(
    "failure",
    [
        lambda request: httpx.Response(503, request=request),
        lambda _request: (_ for _ in ()).throw(OSError("offline")),
    ],
)
def test_retries_retryable_failures(tmp_path, failure):
    calls = 0
    delays = []

    def handler(request):
        nonlocal calls
        calls += 1
        if calls == 1:
            return failure(request)
        return httpx.Response(200, json={"ok": True})

    transport = make_transport(tmp_path, handler, delays=delays)

    assert transport.get(URL) == {"ok": True}
    assert calls == 2
    assert delays == [0]


def test_terminal_4xx_is_not_retried(tmp_path):
    calls = 0
    delays = []

    def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(404, request=request)

    transport = make_transport(tmp_path, handler, delays=delays)

    with pytest.raises(httpx.HTTPStatusError):
        transport.get(URL)

    assert calls == 1
    assert delays == []


def test_invalid_json_is_retried(tmp_path):
    calls = 0
    delays = []

    def handler(_request):
        nonlocal calls
        calls += 1
        return httpx.Response(200, content=b"{")

    transport = make_transport(tmp_path, handler, delays=delays)

    with pytest.raises(RuntimeError, match="failed after 2 attempts"):
        transport.get(URL)

    assert calls == 2
    assert delays == [0, 1]
