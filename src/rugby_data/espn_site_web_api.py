"""ESPN SITE WEB API client (site.web.api.espn.com) — editorial/site API.

This is the endpoint that powers espn.com's public pages, including the rugby
lineups page. Unlike the CORE API (``sports.core.api.espn.com``), its event
``summary`` response carries rugby rosters inline (jersey, position, starter
flag, and the athlete id), so it is the natural source for lineups when the
CORE API has none.
"""

from __future__ import annotations

import re

from .api_client import BaseApiClient
from .config import SITE_WEB_API_BASE


class EspnSiteWebApi(BaseApiClient):
    base_url_default = SITE_WEB_API_BASE

    def get_summary(self, league_id: str, event_id: str) -> dict:
        url = (
            f"{self._base_url}/{league_id}/summary"
            f"?contentorigin=espn&event={event_id}&lang=en&region=us"
        )
        return self.get(url)

    def _describe(self, url: str) -> str:
        path = self._path(url)
        if path.endswith("/summary"):
            league = path.rsplit("/summary", 1)[0].lstrip("/")
            event = ""
            m = re.search(r"[?&]event=(\d+)", url)
            if m:
                event = f"/{m.group(1)}"
            return f"site summary {league}{event}"
        return path or url
