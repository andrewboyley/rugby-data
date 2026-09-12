"""Shared cached JSON transport for the source-specific API clients."""

import json
import sys
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable

from .cache import ApiCache


class ActivityTracker:
    """Thread-safe snapshot of what an API client is currently doing."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._action = "idle"
        self._fetches = 0

    def record(self, action: str) -> None:
        with self._lock:
            self._action = action
            self._fetches += 1

    def snapshot(self) -> tuple[str, int]:
        with self._lock:
            return self._action, self._fetches


class CachedJsonTransport:
    """Fetch JSON with shared cache and retry behavior.

    Clients retain ownership of URL construction, descriptions, headers, and
    source-specific backoff policies.
    """

    def __init__(
        self,
        cache: ApiCache,
        activity: ActivityTracker,
        describe: Callable[[str], str],
        *,
        headers: dict[str, str],
        retries: int,
        timeout: int,
        retry_delay: Callable[[Exception, int], float] | None = None,
    ) -> None:
        self._cache = cache
        self._activity = activity
        self._describe = describe
        self._headers = headers
        self._retries = retries
        self._timeout = timeout
        self._retry_delay = retry_delay or (lambda _error, attempt: 2**attempt)

    def get(self, url: str) -> dict:
        if url in self._cache:
            return self._cache.get(url)
        self._activity.record(self._describe(url))
        data = self.fetch(url)
        self._cache.put(url, data)
        return data

    def fetch(self, url: str) -> dict:
        request = urllib.request.Request(url, headers=self._headers)
        for attempt in range(self._retries):
            try:
                with urllib.request.urlopen(request, timeout=self._timeout) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                if 400 <= error.code < 500 and error.code != 429:
                    raise
                self._retry(url, error, attempt)
            except (OSError, json.JSONDecodeError) as error:
                self._retry(url, error, attempt)
        raise RuntimeError(f"failed after {self._retries} attempts: {url}")

    def _retry(
        self, url: str, error: Exception, attempt: int
    ) -> None:
        print(f"  [retry {attempt}] {self._describe(url)}: {error}", file=sys.stderr)
        time.sleep(self._retry_delay(error, attempt))
