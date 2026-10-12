"""Shared cached JSON transport for source-specific API clients."""

import json
import sys
import threading
from collections.abc import Callable

import httpx
from tenacity import (
    RetryCallState,
    RetryError,
    Retrying,
    retry_if_exception,
    stop_after_attempt,
)

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
        client: httpx.Client | None = None,
    ) -> None:
        self._cache = cache
        self._activity = activity
        self._describe = describe
        self._retries = retries
        self._retry_delay = retry_delay or (lambda _error, attempt: 2**attempt)
        self._client = client or httpx.Client(headers=headers, timeout=timeout)
        self._owns_client = client is None

    def close(self) -> None:
        """Close client created by this transport, not an injected client."""
        if self._owns_client:
            self._client.close()

    def get(self, url: str) -> dict:
        if url in self._cache:
            return self._cache.get(url)
        self._activity.record(self._describe(url))
        data = self.fetch(url)
        self._cache.put(url, data)
        return data

    def fetch(self, url: str) -> dict:
        try:
            for attempt in Retrying(
                retry=retry_if_exception(self._is_retryable),
                stop=stop_after_attempt(self._retries),
                wait=lambda state: self._retry_delay_for(state),
                before_sleep=lambda state: self._report_retry(url, state),
            ):
                with attempt:
                    response = self._client.get(url)
                    response.raise_for_status()
                    return response.json()
        except RetryError as error:
            raise RuntimeError(
                f"failed after {self._retries} attempts: {url}"
            ) from error
        raise RuntimeError(f"failed after {self._retries} attempts: {url}")

    @staticmethod
    def _is_retryable(error: BaseException) -> bool:
        if isinstance(error, httpx.HTTPStatusError):
            return (
                error.response.status_code == 429 or error.response.status_code >= 500
            )
        return isinstance(
            error,
            (httpx.RequestError, OSError, json.JSONDecodeError, UnicodeDecodeError),
        )

    def _retry_delay_for(self, state: RetryCallState) -> float:
        return self._retry_delay(self._retry_error(state), state.attempt_number - 1)

    def _report_retry(self, url: str, state: RetryCallState) -> None:
        error = self._retry_error(state)
        print(
            f"  [retry {state.attempt_number - 1}] {self._describe(url)}: {error}",
            file=sys.stderr,
        )

    @staticmethod
    def _retry_error(state: RetryCallState) -> Exception:
        assert state.outcome is not None
        error = state.outcome.exception()
        assert isinstance(error, Exception)
        return error
