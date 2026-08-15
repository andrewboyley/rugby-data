"""World Rugby RIMS API client with caching, retries, rate limiting,
and activity tracking."""

import json
import sys
import threading
import time
import urllib.error
import urllib.request
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


class ActivityTracker:
    """Thread-safe snapshot of what the API client is currently doing."""

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

    def get(self, url: str) -> dict:
        if url in self._cache:
            return self._cache.get(url)
        self._limiter.wait()
        self.activity.record(self._describe(url))
        data = self._fetch(url)
        self._cache.put(url, data)
        return data

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

    def _fetch(self, url: str) -> dict:
        headers = {"User-Agent": self._user_agent, **RIMS_HEADERS}
        request = urllib.request.Request(url, headers=headers)
        for attempt in range(self._retries):
            try:
                with urllib.request.urlopen(request, timeout=self._timeout) as response:
                    return json.load(response)
            except urllib.error.HTTPError as e:
                if 400 <= e.code < 500 and e.code != 429:
                    raise
                backoff = 2**attempt
                if e.code == 429:
                    backoff = max(backoff, 10)
                print(
                    f"  [retry {attempt}] {self._describe(url)}: {e}", file=sys.stderr
                )
                time.sleep(backoff)
            except (OSError, json.JSONDecodeError) as e:
                backoff = 2**attempt
                if isinstance(e, urllib.error.HTTPError) and e.code == 429:
                    backoff = max(backoff, 10)
                print(
                    f"  [retry {attempt}] {self._describe(url)}: {e}", file=sys.stderr
                )
                time.sleep(backoff)
        raise RuntimeError(f"failed after {self._retries} attempts: {url}")

    def _describe(self, url: str) -> str:
        path = url.replace(self._base_url, "").split("?")[0].rstrip("/")
        if path.startswith("/match/") and "/summary" in path:
            return f"summary {path.split('/')[2][:8]}"
        if path == "/match":
            return "match discovery"
        return path or url
