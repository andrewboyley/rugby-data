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
                for m in matches:
                    mid = m.get("matchId") or m.get("id")
                    if mid:
                        urls.add(f"{self._rims_api._base_url}/match/{mid}")
                    match_date = (m.get("time") or {}).get("label", "")
                    rims_team_ids = [
                        t.get("id") for t in m.get("teams", []) if t.get("id")
                    ]
                    self._rims_match_data[str(mid)] = (match_date, rims_team_ids)
        if self._source == "espn":
            for team_id in self._team_ids:
                for year in self._years:
                    try:
                        urls.update(self._espn_api.events_for_year(team_id, year))
                    except Exception as exc:
                        print(
                            f"[WARN] ESPN discovery failed for "
                            f"team {team_id} year {year}: {exc}",
                            file=sys.stderr,
                        )
                        continue
        return sorted(urls)
