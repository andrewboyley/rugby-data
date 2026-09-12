"""World Rugby RIMS API client with caching, retries, rate limiting,
and activity tracking."""

import threading
import time
from collections import deque

from .cache import ApiCache
from .config import (
    REQUEST_TIMEOUT_SECONDS,
    RETRY_ATTEMPTS,
    RIMS_API_BASE,
    RIMS_HEADERS,
    RIMS_RATE_LIMIT_PER_MIN,
    USER_AGENT,
)
from .transport import ActivityTracker, CachedJsonTransport


class RateLimiter:
    """Simple sliding-window rate limiter (requests per minute)."""

    def __init__(self, max_per_minute: int) -> None:
        self._max = max_per_minute
        self._window = 60.0
        self._times: deque[float] = deque()
        self._lock = threading.Lock()

    def wait(self) -> None:
        if self._max <= 0:
            return
        with self._lock:
            now = time.monotonic()
            while self._times and now - self._times[0] > self._window:
                self._times.popleft()
            if len(self._times) >= self._max:
                sleep_for = self._window - (now - self._times[0])
                if sleep_for > 0:
                    time.sleep(sleep_for)
                now = time.monotonic()
                while self._times and now - self._times[0] > self._window:
                    self._times.popleft()
            self._times.append(now)


class RimsApi:
    def __init__(
        self,
        cache: ApiCache,
        base_url: str = RIMS_API_BASE,
        *,
        retries: int = RETRY_ATTEMPTS,
        timeout: int = REQUEST_TIMEOUT_SECONDS,
        user_agent: str = USER_AGENT,
        rate_limit_per_min: int = RIMS_RATE_LIMIT_PER_MIN,
    ):
        self._cache = cache
        self._base_url = base_url
        self._retries = retries
        self._timeout = timeout
        self._user_agent = user_agent
        self._limiter = RateLimiter(rate_limit_per_min)
        self.activity = ActivityTracker()
        self._transport = CachedJsonTransport(
            cache,
            self.activity,
            self._describe,
            headers={"User-Agent": user_agent, **RIMS_HEADERS},
            retries=retries,
            timeout=timeout,
            retry_delay=self._retry_delay,
        )

    def get(self, url: str) -> dict:
        if url in self._cache:
            return self._cache.get(url)
        self._limiter.wait()
        return self._transport.get(url)

    def matches_for_year(self, year: int) -> list[dict]:
        """Return all completed matches in a given year."""
        matches = []
        page = 0
        while True:
            url = (
                f"{self._base_url}/match?states=C"
                f"&startDate={year}-01-01&endDate={year}-12-31"
                f"&page={page}&pageSize=100&sort=asc"
            )
            data = self.get(url)
            content = data.get("content", [])
            matches.extend(content)
            page_info = data.get("pageInfo", {})
            if page >= page_info.get("numPages", 1) - 1:
                break
            page += 1
        return matches

    def matches_for_year_with_teams(self, year: int, team_ids: str) -> list[dict]:
        """Return completed matches in a given year for the given
        comma-separated team ids."""
        matches = []
        page = 0
        while True:
            url = (
                f"{self._base_url}/match?states=C"
                f"&startDate={year}-01-01&endDate={year}-12-31"
                f"&teams={team_ids}"
                f"&page={page}&pageSize=100&sort=asc"
            )
            data = self.get(url)
            content = data.get("content", [])
            matches.extend(content)
            page_info = data.get("pageInfo", {})
            if page >= page_info.get("numPages", 1) - 1:
                break
            page += 1
        return matches

    def match_summary(self, match_id: str) -> dict:
        """Return full match summary with team lineups."""
        url = f"{self._base_url}/match/{match_id}/summary"
        return self.get(url)

    def _retry_delay(self, error: Exception, attempt: int) -> float:
        if getattr(error, "code", None) == 429:
            return max(2**attempt, 10)
        return 2**attempt

    def _describe(self, url: str) -> str:
        path = url.replace(self._base_url, "").split("?")[0].rstrip("/")
        if path.startswith("/match/") and "/summary" in path:
            return f"summary {path.split('/')[2][:8]}"
        if path == "/match":
            return "match discovery"
        return path or url
