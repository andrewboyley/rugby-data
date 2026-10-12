"""ESPN CORE API client with caching, retries, and activity tracking."""

from __future__ import annotations

from .api_client import BaseApiClient
from .config import CORE_API_BASE


class EspnApi(BaseApiClient):
    base_url_default = CORE_API_BASE

    def events_for_year(self, team_id: str, year: int) -> list[str]:
        url = (
            f"{self._base_url}/teams/{team_id}/events"
            f"?dates={year}0101-{year}1231&limit=200"
        )
        return [item["$ref"] for item in self.get(url).get("items", [])]

    def _describe(self, url: str) -> str:
        """Human-readable label for a CORE API url."""
        path = self._path(url)
        if path.endswith("/events"):
            return "event discovery"
        if "/athletes/" in path:
            return f"athlete {_last_segment(path)}"
        if "/score" in path:
            return f"score team {_competitor_id(path)}"
        if "/roster" in path:
            return f"roster team {_competitor_id(path)}"
        if "/competitions/" in path and "events" in path:
            return "competition"
        if "/teams/" in path:
            return f"team {_last_segment(path)}"
        if "/events/" in path:
            return f"event {_last_segment(path)}"
        return path or url


def _last_segment(path: str) -> str:
    return path.rsplit("/", 1)[-1]


def _competitor_id(path: str) -> str:
    return path.split("competitors/")[-1].split("/")[0]


def event_id_from_url(url: str) -> str:
    return url.rsplit("/", 1)[-1].split("?")[0]
