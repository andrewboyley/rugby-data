"""ESPN SITE WEB API client (site.web.api.espn.com) — editorial/site API.

This is the endpoint that powers espn.com's public pages, including the rugby
lineups page. Unlike the CORE API (``sports.core.api.espn.com``), its event
``summary`` response carries rugby rosters inline (jersey, position, starter
flag, and the athlete id), so it is the natural source for lineups when the
CORE API has none.
"""

import re

from .cache import ApiCache
from .config import (
    REQUEST_TIMEOUT_SECONDS,
    RETRY_ATTEMPTS,
    SITE_WEB_API_BASE,
    USER_AGENT,
)
from .transport import ActivityTracker, CachedJsonTransport


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
        self._transport = CachedJsonTransport(
            cache,
            self.activity,
            self._describe,
            headers={"User-Agent": user_agent},
            retries=retries,
            timeout=timeout,
        )

    def get_summary(self, league_id: str, event_id: str) -> dict:
        url = (
            f"{self._base_url}/{league_id}/summary"
            f"?contentorigin=espn&event={event_id}&lang=en&region=us"
        )
        return self.get(url)

    def get(self, url: str) -> dict:
        return self._transport.get(url)

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
