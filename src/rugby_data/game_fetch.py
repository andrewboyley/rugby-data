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
    partial: Game | None = None  # parsed game even if incomplete, for labelling


class GameFetchMixin(BuilderBase):
    """RIMS-first fetch with ESPN fallback discovery."""

    def _fetch_rims(self, match_id: str) -> dict:
        try:
            return self._rims_api.match_summary(match_id)
        except Exception as exc:
            raise RuntimeError(
                f"RIMS summary failed for match {match_id}: {exc}"
            ) from exc

    def _fetch_game(self, event_url: str) -> FetchResult:
        if self._source == "espn":
            return self._fetch_game_espn(event_url)
        match_id = event_id_from_url(event_url)
        if self._source == "rims":
            return self._fetch_game_rims_only(event_url, match_id)
        # rims-first: prefer RIMS, fall back to ESPN on error OR incomplete
        return self._fetch_game_rims_first(match_id)

    def _fetch_game_espn(self, event_url: str) -> FetchResult:
        # Site web API is the complete source (teams, scores, rosters). The CORE
        # API is only used for event discovery, not as a data source.
        try:
            game = self._fetch_game_espn_site_web(event_url)
            match_id = event_id_from_url(event_url) if event_url else None
            if game is not None:
                return FetchResult(game, None, match_id, source="espn")
            msg = "ESPN fetch returned None"
            return FetchResult(None, msg, match_id, source="espn")
        except Exception as exc:
            match_id = event_id_from_url(event_url) if event_url else None
            return FetchResult(None, str(exc), match_id, source="espn")

    def _fetch_game_rims_only(self, event_url: str, match_id: str) -> FetchResult:
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

    def _fetch_game_rims_first(self, match_id: str) -> FetchResult:
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
        return self._fetch_espn_fallback(match_id, rims_game, rims_error)

    def _fetch_espn_fallback(
        self,
        match_id: str,
        rims_game: Game | None,
        rims_error: str | None,
    ) -> FetchResult:
        rims_status = (
            "incomplete (no roster)"
            if rims_game is not None
            else f"error: {rims_error}"
        )
        try:
            print(
                f"  [fallback] {match_id}: RIMS {rims_status} -> trying ESPN",
                file=sys.stderr,
            )
            espn_url = (
                self._get_espn_fallback_url(match_id) if match_id is not None else None
            )
            if not espn_url:
                return self._no_espn_match(match_id, rims_status, rims_error, rims_game)
            return self._espn_completion(match_id, espn_url, rims_status, rims_game)
        except Exception as exc:
            return FetchResult(
                None,
                f"unexpected: {exc}",
                match_id,
                source="rims→espn",
                fell_back=True,
                partial=rims_game,
            )

    def _no_espn_match(
        self,
        match_id: str,
        rims_status: str,
        rims_error: str | None,
        rims_game: Game | None,
    ) -> FetchResult:
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

    def _espn_completion(
        self,
        match_id: str,
        espn_url: str,
        rims_status: str,
        rims_game: Game | None,
    ) -> FetchResult:
        # ESPN tier: the site web API is a complete source (teams, scores,
        # and rugby rosters). The CORE API is used only for event discovery;
        # its own game responses carry no rugby rosters, so it cannot
        # complete a game and is not used as a data source.
        game = self._fetch_game_espn_site_web(espn_url)
        if game and game.is_complete():
            return FetchResult(game, None, match_id, source="rims→espn", fell_back=True)
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

    def _get_espn_fallback_url(self, match_id: str) -> str | None:
        if match_id in self._espn_fallback_map:
            return self._espn_fallback_map[match_id]
        if self._is_neg_match(match_id):
            return None
        inputs = self._espn_fallback_inputs(match_id)
        if inputs is None:
            return None
        date, espn_team_ids, target_teams, search_years = inputs
        url = self._search_espn_years(search_years, espn_team_ids, date, target_teams)
        if url is None:
            self._record_neg_match(match_id, "no ESPN match found")
            return None
        self._espn_fallback_map[match_id] = url
        return url

    def _espn_fallback_inputs(
        self, match_id: str
    ) -> tuple[str, list[str], frozenset, list[int]] | None:
        match_data = self._rims_match_data.get(match_id)
        if not match_data:
            return None
        date, rims_team_ids = match_data
        if not date or not rims_team_ids:
            return None
        search_years = self._espn_search_years(date)
        if search_years is None:
            return None
        espn_team_ids = [self._RIMS_TO_ESPN.get(t, t) for t in rims_team_ids]
        return date, espn_team_ids, frozenset(espn_team_ids), search_years

    def _search_espn_years(
        self,
        search_years: list[int],
        espn_team_ids: list[str],
        date: str,
        target_teams: frozenset,
    ) -> str | None:
        for year in search_years:
            for espn_id in espn_team_ids:
                url = self._find_espn_event(espn_id, year, date, target_teams)
                if url is not None:
                    return url
        return None

    def _espn_search_years(self, date: str) -> list[int] | None:
        try:
            match_year = int(date[:4])
        except (ValueError, TypeError):
            return None
        search_years = [match_year]
        if match_year - 1 in self._years:
            search_years.append(match_year - 1)
        if match_year + 1 in self._years:
            search_years.append(match_year + 1)
        return search_years

    def _find_espn_event(
        self,
        espn_id: str,
        year: int,
        date: str,
        target_teams: frozenset,
    ) -> str | None:
        try:
            event_urls = self._espn_api.events_for_year(espn_id, year)
        except Exception:
            return None
        for url in event_urls:
            event = self._cached_espn_event(url)
            if event is not None and self._espn_event_matches(
                event, date, target_teams
            ):
                return url
        return None

    def _cached_espn_event(self, url: str) -> dict | None:
        if url in self._espn_event_cache:
            return self._espn_event_cache[url]
        try:
            event = self._espn_api.get(url)
        except Exception:
            return None
        self._espn_event_cache[url] = event
        return event

    def _espn_event_matches(
        self,
        event: dict,
        date: str,
        target_teams: frozenset,
    ) -> bool:
        event_date = (event.get("date") or "")[:10]
        event_teams = set()
        for comp in event.get("competitions", [{}])[0].get("competitors", []):
            event_teams.add(comp.get("id"))
        return event_date == date and frozenset(event_teams) == target_teams
