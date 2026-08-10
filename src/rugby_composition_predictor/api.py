"""ESPN CORE API client with caching, retries, and activity tracking."""

import json
import threading
import time
import urllib.request
from typing import Callable, Optional

from .cache import ApiCache
from .config import (
    CORE_API_BASE,
    REQUEST_TIMEOUT_SECONDS,
    RETRY_ATTEMPTS,
    SOUTH_AFRICA_TEAM_ID,
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


class EspnApi:
    def __init__(
        self,
        cache: ApiCache,
        base_url: str = CORE_API_BASE,
        *,
        retries: int = RETRY_ATTEMPTS,
        timeout: int = REQUEST_TIMEOUT_SECONDS,
        user_agent: str = USER_AGENT,
    ):
        self._cache = cache
        self._base_url = base_url
        self._retries = retries
        self._timeout = timeout
        self._user_agent = user_agent
        self.activity = ActivityTracker()

    def get(self, url: str) -> dict:
        if url in self._cache:
            return self._cache.get(url)
        self.activity.record(self._describe(url))
        data = self._fetch(url)
        self._cache.put(url, data)
        return data

    def events_for_year(self, team_id: str, year: int) -> list[str]:
        url = (
            f"{self._base_url}/teams/{team_id}/events"
            f"?dates={year}0101-{year}1231&limit=200"
        )
        return [item["$ref"] for item in self.get(url).get("items", [])]

    def _fetch(self, url: str) -> dict:
        request = urllib.request.Request(
            url, headers={"User-Agent": self._user_agent})
        for attempt in range(self._retries):
            try:
                with urllib.request.urlopen(
                        request, timeout=self._timeout) as response:
                    return json.load(response)
            except Exception as e:
                print(f"  [retry {attempt}] {self._describe(url)}: {e}",
                      file=sys.stderr)
                time.sleep(2 ** attempt)
        raise RuntimeError(f"failed after {self._retries} attempts: {url}")

    def _describe(self, url: str) -> str:
        """Human-readable label for a CORE API url."""
        base = url.replace(self._base_url, "")
        base = base.split("?")[0].rstrip("/")
        if "teams/5/events" in base:
            return "event discovery"
        if "/athletes/" in base:
            return f"athlete {base.rsplit('/', 1)[-1]}"
        if "/score" in base:
            return f"score team {base.split('competitors/')[-1].split('/')[0]}"
        if "/roster" in base:
            return f"roster team {base.split('competitors/')[-1].split('/')[0]}"
        if "/competitions/" in base and "events" in base:
            return "competition"
        if "/teams/" in base:
            return f"team {base.rsplit('/', 1)[-1]}"
        if "/events/" in base:
            return f"event {base.rsplit('/', 1)[-1]}"
        return base or url


def event_id_from_url(url: str) -> int:
    return int(url.rsplit("/", 1)[-1].split("?")[0])
