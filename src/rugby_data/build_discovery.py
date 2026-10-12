"""Event discovery helpers for dataset building."""

from __future__ import annotations

import sys

from .builder_base import BuilderBase
from .config import RIMS_TEAM_IDS


class BuildDiscoveryMixin(BuilderBase):
    """Discover event URLs from RIMS and/or ESPN."""

    def _discover_event_urls(self) -> list[str]:
        urls: set[str] = set()
        if self._source in ("rims-first", "rims"):
            self._discover_rims_urls(urls)
        if self._source == "espn":
            self._discover_espn_urls(urls)
        return sorted(urls)

    def _discover_rims_urls(self, urls: set[str]) -> None:
        rims_ids = ",".join(RIMS_TEAM_IDS.get(t, t) for t in self._team_ids)
        for year in self._years:
            try:
                matches = self._rims_api.matches_for_year_with_teams(year, rims_ids)
            except Exception as exc:
                print(
                    f"[WARN] RIMS discovery failed for year {year}: {exc}",
                    file=sys.stderr,
                )
                continue
            for match in matches:
                self._add_rims_match(urls, match)

    def _add_rims_match(self, urls: set[str], match: dict) -> None:
        mid = match.get("matchId") or match.get("id")
        if mid:
            urls.add(f"{self._rims_api._base_url}/match/{mid}")
        match_date = (match.get("time") or {}).get("label", "")
        rims_team_ids = [t.get("id") for t in match.get("teams", []) if t.get("id")]
        self._rims_match_data[str(mid)] = (match_date, rims_team_ids)

    def _discover_espn_urls(self, urls: set[str]) -> None:
        for team_id in self._team_ids:
            for year in self._years:
                urls.update(self._espn_events_safe(team_id, year))

    def _espn_events_safe(self, team_id: str, year: int) -> list:
        try:
            return self._espn_api.events_for_year(team_id, year)
        except Exception as exc:
            print(
                f"[WARN] ESPN discovery failed for team {team_id} year {year}: {exc}",
                file=sys.stderr,
            )
            return []
