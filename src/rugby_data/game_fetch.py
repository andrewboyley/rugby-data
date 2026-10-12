"""Primary fetch orchestration and ESPN fallback discovery."""

from __future__ import annotations

import sys
from dataclasses import dataclass

from .api import event_id_from_url
from .builder_base import BuilderBase
from .models import Game


@dataclass
class FetchResult:
    game: Game | None
    error: str | None
    match_id: str | None
    source: str = "unknown"  # "rims" | "espn" | "rims→espn"
    fell_back: bool = False
    partial: Game | None = None


class GameFetchMixin(BuilderBase):
    """RIMS-first fetch with ESPN fallback discovery."""

    def _fetch_game(self, event_url: str) -> FetchResult:
        if self._source == "espn":
            try:
                # Site web API is the complete source (teams, scores, rosters).
                # The CORE API is only used for event discovery, not as a data
                # source, so it is not attempted here.
                game = self._fetch_game_espn_site_web(event_url)
                match_id = event_id_from_url(event_url) if event_url else None
                if game is not None:
                    return FetchResult(game, None, match_id, source="espn")
                msg = "ESPN fetch returned None"
                return FetchResult(None, msg, match_id, source="espn")
            except Exception as exc:
                match_id = event_id_from_url(event_url) if event_url else None
                return FetchResult(None, str(exc), match_id, source="espn")
        match_id = event_id_from_url(event_url)
        if self._source == "rims":
            try:
                summary = self._fetch_rims(match_id)
                game = self._game_from_rims(summary)
                if game.is_complete():
                    return FetchResult(game, None, match_id, source="rims")
                self._record_terminal_fail(match_id, "RIMS game incomplete")
                msg = "RIMS game incomplete"
                return FetchResult(None, msg, match_id, source="rims", partial=game)
            except Exception as exc:
                print(f"  [RIMS only] {event_url}: {exc}", file=sys.stderr)
                return FetchResult(None, str(exc), match_id, source="rims")
        # rims-first: prefer RIMS, fall back to ESPN on error OR incomplete
        rims_game = None
        rims_error = None
        try:
            summary = self._fetch_rims(match_id)
            rims_game = self._game_from_rims(summary)
        except Exception as exc:
            rims_error = str(exc)
        if rims_game is not None and rims_game.is_complete():
            return FetchResult(rims_game, None, match_id, source="rims")

        # RIMS missing or incomplete -> fall back to ESPN for the lineup
        try:
            rims_status = (
                "incomplete (no roster)"
                if rims_game is not None
                else f"error: {rims_error}"
            )
            print(
                f"  [fallback] {match_id}: RIMS {rims_status} -> trying ESPN",
                file=sys.stderr,
            )
            espn_url = (
                self._get_espn_fallback_url(match_id) if match_id is not None else None
            )
            if not espn_url:
                error = (
                    f"RIMS {rims_status}; no ESPN match found"
                    if rims_game is not None
                    else f"RIMS error ({rims_error}); no ESPN match found"
                )
                self._record_terminal_fail(match_id, error)
                return FetchResult(
                    None,
                    error,
                    match_id,
                    source="rims→espn",
                    fell_back=True,
                    partial=rims_game,
                )
            # ESPN tier: the site web API is a complete source (teams, scores,
            # and rugby rosters). The CORE API is used only for event discovery;
            # its own game responses carry no rugby rosters, so it cannot
            # complete a game and is not used as a data source.
            game = self._fetch_game_espn_site_web(espn_url)
            if game and game.is_complete():
                return FetchResult(
                    game, None, match_id, source="rims→espn", fell_back=True
                )
            path = self._espn_event_path(espn_url)
            if path is not None:
                self._record_neg_lineup(path[1], "ESPN site web incomplete")
            self._record_terminal_fail(
                match_id, "RIMS incomplete; ESPN site web incomplete"
            )
            return FetchResult(
                None,
                f"RIMS {rims_status}; ESPN site web incomplete",
                match_id,
                source="rims→espn",
                fell_back=True,
                partial=game if game is not None else rims_game,
            )
        except Exception as exc:
            return FetchResult(
                None,
                f"unexpected: {exc}",
                match_id,
                source="rims→espn",
                fell_back=True,
                partial=rims_game,
            )

    def _get_espn_fallback_url(self, match_id: str) -> str | None:
        if match_id in self._espn_fallback_map:
            return self._espn_fallback_map[match_id]
        if self._is_neg_match(match_id):
            return None
        match_data = self._rims_match_data.get(match_id)
        if not match_data:
            return None
        date, rims_team_ids = match_data
        if not date or not rims_team_ids:
            return None
        espn_team_ids = [self._RIMS_TO_ESPN.get(t, t) for t in rims_team_ids]
        target_teams = frozenset(espn_team_ids)
        try:
            match_year = int(date[:4])
        except (ValueError, TypeError):
            return None
        search_years = [match_year]
        if match_year - 1 in self._years:
            search_years.append(match_year - 1)
        if match_year + 1 in self._years:
            search_years.append(match_year + 1)
        for year in search_years:
            for espn_id in espn_team_ids:
                try:
                    event_urls = self._espn_api.events_for_year(espn_id, year)
                except Exception:
                    continue
                for url in event_urls:
                    if url in self._espn_event_cache:
                        event = self._espn_event_cache[url]
                    else:
                        try:
                            event = self._espn_api.get(url)
                            self._espn_event_cache[url] = event
                        except Exception:
                            continue
                    event_date = (event.get("date") or "")[:10]
                    event_teams = set()
                    for comp in event.get("competitions", [{}])[0].get(
                        "competitors", []
                    ):
                        event_teams.add(comp.get("id"))
                    if event_date == date and frozenset(event_teams) == target_teams:
                        self._espn_fallback_map[match_id] = url
                        return url
        self._record_neg_match(match_id, "no ESPN match found")
        return None
