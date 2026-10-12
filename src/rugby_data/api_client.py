"""Shared plumbing for the cache-aware JSON API clients.

The ESPN CORE, ESPN SITE WEB, and World Rugby RIMS clients all wrap the same
:class:`~rugby_data.transport.CachedJsonTransport` with a client-specific
``_describe`` label and (for RIMS) a rate limiter and retry backoff. This base
class owns the transport construction, ``close``, ``get``, and URL-path helper
so those clients stay focused on their own endpoints.
"""

from __future__ import annotations

from collections.abc import Callable

from .cache import ApiCache
from .config import REQUEST_TIMEOUT_SECONDS, RETRY_ATTEMPTS, USER_AGENT
from .transport import ActivityTracker, CachedJsonTransport


class BaseApiClient:
    """Cache-aware JSON client: transport, ``get``/``close``, URL labelling."""

    #: Endpoint base used when the caller does not pass ``base_url``.
    base_url_default: str = ""

    def __init__(
        self,
        cache: ApiCache,
        base_url: str | None = None,
        *,
        retries: int = RETRY_ATTEMPTS,
        timeout: int = REQUEST_TIMEOUT_SECONDS,
        user_agent: str = USER_AGENT,
        extra_headers: dict[str, str] | None = None,
        retry_delay: Callable[[Exception, int], float] | None = None,
    ):
        self._cache = cache
        self._base_url = base_url if base_url is not None else self.base_url_default
        self._retries = retries
        self._timeout = timeout
        self._user_agent = user_agent
        self.activity = ActivityTracker()
        self._transport = CachedJsonTransport(
            cache,
            self.activity,
            self._describe,
            headers={"User-Agent": user_agent, **(extra_headers or {})},
            retries=retries,
            timeout=timeout,
            retry_delay=retry_delay,
        )

    def close(self) -> None:
        self._transport.close()

    def get(self, url: str) -> dict:
        return self._transport.get(url)

    def _path(self, url: str) -> str:
        """Return the request path with the base URL, query, and slash removed."""
        return url.replace(self._base_url, "").split("?")[0].rstrip("/")

    def _describe(self, url: str) -> str:
        return self._path(url) or url
