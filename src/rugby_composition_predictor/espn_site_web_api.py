"""ESPN SITE WEB API client (site.web.api.espn.com) — editorial/site API.

This is the endpoint that powers espn.com's public pages, including the rugby
lineups page. Unlike the CORE API (``sports.core.api.espn.com``), its event
``summary`` response carries rugby rosters inline (jersey, position, starter
flag, and the athlete id), so it is the natural source for lineups when the
CORE API has none.
"""

import json
import re
import sys
import time
import urllib.error
import urllib.request

from .api import ActivityTracker
from .cache import ApiCache
from .config import (
    REQUEST_TIMEOUT_SECONDS,
    RETRY_ATTEMPTS,
    SITE_WEB_API_BASE,
    USER_AGENT,
)


class EspnSiteWebApi:
    def __init__(
        self,
        cache: ApiCache,
        base_url: str = SITE_WEB_API_BASE,
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

    def get_summary(self, league_id: str, event_id: str) -> dict:
        url = (
            f"{self._base_url}/{league_id}/summary"
            f"?contentorigin=espn&event={event_id}&lang=en&region=us"
        )
        return self.get(url)

    def get(self, url: str) -> dict:
        if url in self._cache:
            return self._cache.get(url)
        self.activity.record(self._describe(url))
        data = self._fetch(url)
        self._cache.put(url, data)
        return data

    def _fetch(self, url: str) -> dict:
        request = urllib.request.Request(url, headers={"User-Agent": self._user_agent})
        for attempt in range(self._retries):
            try:
                with urllib.request.urlopen(request, timeout=self._timeout) as response:
                    return json.load(response)
            except urllib.error.HTTPError as e:
                if 400 <= e.code < 500 and e.code != 429:
                    raise
                print(
                    f"  [retry {attempt}] {self._describe(url)}: {e}", file=sys.stderr
                )
                time.sleep(2**attempt)
            except (OSError, json.JSONDecodeError) as e:
                print(
                    f"  [retry {attempt}] {self._describe(url)}: {e}", file=sys.stderr
                )
                time.sleep(2**attempt)
        raise RuntimeError(f"failed after {self._retries} attempts: {url}")

    def _describe(self, url: str) -> str:
        path = url.replace(self._base_url, "").split("?")[0].rstrip("/")
        if path.endswith("/summary"):
            league = path.rsplit("/summary", 1)[0].lstrip("/")
            event = ""
            m = re.search(r"[?&]event=(\d+)", url)
            if m:
                event = f"/{m.group(1)}"
            return f"site summary {league}{event}"
        return path or url
