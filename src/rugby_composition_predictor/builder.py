"""Orchestrates fetching a rugby dataset from the RIMS API (primary, ESPN fallback)."""

import re
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

from .api import EspnApi, event_id_from_url
from .cache import ApiCache
from .config import (
    DEFAULT_MAX_WORKERS,
    DEFAULT_SAVE_EVERY,
    HOME_KIT_COLOURS,
    INTERNATIONAL_TEAM_IDS,
    RIMS_MAX_WORKERS,
    RIMS_TEAM_IDS,
    RIMS_TEAM_NAMES,
    SECONDARY_KIT_COLOURS,
    YEARS,
)
from .dataset import Dataset
from .espn_site_web_api import EspnSiteWebApi
from .models import Competitor, Game, RosterEntry
from .reporting import BuildListener
from .rims_api import RimsApi

# Prefix for cache entries recording a match that is deterministically
# unresolvable (RIMS has no usable roster and no ESPN fallback exists/completes).
# Used by --skip-failed to omit such matches on subsequent builds.
NEG_FAIL_PREFIX = "negative://failed/"


@dataclass
class FetchResult:
    game: Game | None
    error: str | None
    match_id: str | None
    source: str = "unknown"  # "rims" | "espn" | "rims→espn"
    fell_back: bool = False
    partial: Game | None = None  # parsed game even if incomplete, for labelling


class DatasetBuilder:
    def __init__(
        self,
        rims_api: RimsApi,
        espn_api: EspnApi,
        cache: ApiCache,
        dataset: Dataset,
        output_path: Path,
        *,
        team_ids: list[str] | None = None,
        years=YEARS,
        max_workers: int = DEFAULT_MAX_WORKERS,
        save_every: int = DEFAULT_SAVE_EVERY,
        source: str = "rims-first",
    ):
        self._rims_api = rims_api
        self._espn_api = espn_api
        self._espn_site_web_api = EspnSiteWebApi(cache)
        self._cache = cache
        self._dataset = dataset
        self._output_path = output_path
        self._team_ids = team_ids if team_ids is not None else INTERNATIONAL_TEAM_IDS
        self._years = years
        self._max_workers = max_workers
        self._save_every = save_every
        self._requests = 0
        self._source = source
        self._espn_fallback_map: dict[str, str] = {}
        self._rims_match_data: dict[str, tuple[str, list[str]]] = {}
        self._espn_event_cache: dict[str, dict] = {}
        self._RIMS_TO_ESPN = {v: k for k, v in RIMS_TEAM_IDS.items()}
        if source in ("rims-first", "rims"):
            self._max_workers = min(self._max_workers, RIMS_MAX_WORKERS)

    def build(
        self,
        listener: BuildListener | None = None,
        skip_failed: bool = False,
    ) -> None:
        for game in self._dataset.games:
            self._cache.mark_processed(game.event_id)

        event_urls = self._discover_event_urls()
        pending = [
            u for u in event_urls if not self._cache.is_processed(event_id_from_url(u))
        ]
        if skip_failed:
            skipped = [
                u for u in pending
                if self._is_terminal_fail(event_id_from_url(u))
            ]
            if skipped:
                pending = [
                    u for u in pending
                    if not self._is_terminal_fail(event_id_from_url(u))
                ]
                print(
                    f"[skip] {len(skipped)} previously-failed matches (--skip-failed)",
                    file=sys.stderr,
                )

        print(
            f"[1/2] Found {len(event_urls)} events, {len(pending)} to fetch\n",
            file=sys.stderr,
        )

        if listener:
            listener.task_started(len(pending))

        t0 = time.time()
        results: list[FetchResult] = []
        with ThreadPoolExecutor(max_workers=self._max_workers) as pool:
            future_to_url = {pool.submit(self._fetch_game, u): u for u in pending}
            for i, future in enumerate(as_completed(future_to_url), 1):
                event_url = future_to_url[future]
                result = future.result()
                results.append(result)
                game = result.game
                if game is not None and game.is_complete():
                    self._cache.mark_processed(event_id_from_url(event_url))
                    self._dataset.merge([game])
                self._report(listener, i, result)
                if i % self._save_every == 0 or i == len(pending):
                    self._dataset.save(self._output_path)
                    # Only rewrite the cache if a real network fetch added a
                    # response this run; on a from-cache rebuild nothing was
                    # fetched, so a soft save is a no-op (avoids rewriting the
                    # multi-MB cache file needlessly).
                    self._cache.save()

        self._dataset.save(self._output_path)
        self._cache.save(force=True)
        if listener:
            listener.task_finished()

        elapsed = time.time() - t0
        self._print_summary(len(pending), elapsed)
        self._print_failures(results)
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

    # ---- primary fetch (RIMS-first) ----

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
                self._get_espn_fallback_url(match_id)
                if match_id is not None
                else None
            )
            if not espn_url:
                error = (
                    f"RIMS {rims_status}; no ESPN match found"
                    if rims_game is not None
                    else f"RIMS error ({rims_error}); no ESPN match found"
                )
                self._record_terminal_fail(match_id, error)
                return FetchResult(None, error, match_id, source="rims→espn",
                                   fell_back=True, partial=rims_game)
            # ESPN tier: the site web API is a complete source (teams, scores,
            # and rugby rosters). The CORE API is used only for event discovery;
            # its own game responses carry no rugby rosters, so it cannot
            # complete a game and is not used as a data source.
            game = self._fetch_game_espn_site_web(espn_url)
            if game and game.is_complete():
                return FetchResult(game, None, match_id, source="rims→espn",
                                   fell_back=True)
            path = self._espn_event_path(espn_url)
            if path is not None:
                self._record_neg_lineup(path[1], "ESPN site web incomplete")
            self._record_terminal_fail(
                match_id, "RIMS incomplete; ESPN site web incomplete"
            )
            return FetchResult(
                None, f"RIMS {rims_status}; ESPN site web incomplete", match_id,
                source="rims→espn", fell_back=True,
                partial=game if game is not None else rims_game,
            )
        except Exception as exc:
            return FetchResult(None, f"unexpected: {exc}", match_id,
                               source="rims→espn", fell_back=True,
                               partial=rims_game)
    def _fetch_rims(self, match_id: str) -> dict:
        try:
            return self._rims_api.match_summary(match_id)
        except Exception as exc:
            raise RuntimeError(
                f"RIMS summary failed for match {match_id}: {exc}"
            ) from exc

    def _game_from_rims(self, summary: dict) -> Game:
        try:
            match = summary.get("match") or {}
            event_id = str(match.get("matchId") or "")
            date = (match.get("time") or {}).get("label")
            teams = summary.get("teams", [])
            match_teams = match.get("teams", [])

            venue_id = self._register_venue_from_rims(match)
            league_id = self._register_league_from_rims(match)

            competitors = []
            for i, team_data in enumerate(teams):
                home = i == 0
                meta = match_teams[i] if i < len(match_teams) else {}
                team_id = int(meta.get("id") or 0)
                self._register_team_from_rims(team_id, team_data, meta)
                competitors.append(
                    Competitor(
                        team_id=team_id,
                        home=home,
                        score=self._extract_rims_score(match, home),
                        roster=self._fetch_rims_roster(team_data),
                        coach_id=self._extract_rims_coach(team_data),
                    )
                )

            return Game(
                event_id=event_id,
                date=date,
                competitors=competitors,
                venue_id=venue_id,
                league_id=league_id,
            )
        except Exception as exc:
            print(f"[WARN] RIMS game parse failed: {exc}", file=sys.stderr)
            raise

    def _extract_rims_score(self, match_data: dict, home: bool) -> int | None:
        scores = match_data.get("scores", [])
        index = 0 if home else 1
        if index < len(scores):
            value = scores[index]
            try:
                return int(value)
            except (TypeError, ValueError):
                pass
        return None

    def _fetch_rims_roster(self, team_data: dict) -> list[RosterEntry]:
        roster_block = team_data.get("teamList") or {}
        entries = roster_block.get("list") or []
        roster: list[RosterEntry] = []
        for entry in entries:
            try:
                # Skip coach/management entries: RIMS lists them inside the
                # squad with a null jersey number. Without this filter the head
                # coach appears in the roster (and graph) as a player.
                if self._is_rims_staff(entry):
                    continue
                player_id = str(entry.get("player", {}).get("id") or "")
                if not player_id:
                    continue
                self._register_player_from_rims(player_id, entry)
                roster.append(
                    RosterEntry(
                        player_id=player_id,
                        jersey=self._parse_jersey(entry.get("number")),
                    )
                )
            except Exception as exc:
                print(
                    f"[WARN] RIMS roster entry skipped: {exc}",
                    file=sys.stderr,
                )
        return roster

    def _register_venue_from_rims(self, match: dict) -> str | None:
        venue = match.get("venue") or {}
        venue_id = venue.get("id")
        if not venue_id:
            return None
        # RIMS ids are Opta/Pulselive ids — use them as the canonical key.
        key = str(venue_id)
        if self._dataset.venue_name(key):
            return key
        try:
            self._dataset.register_venue(
                key,
                venue.get("name") or str(venue_id),
                city=venue.get("city"),
                country=venue.get("country"),
            )
        except Exception as exc:
            print(f"[WARN] RIMS venue register failed: {exc}", file=sys.stderr)
        return key

    def _register_league_from_rims(self, match: dict) -> str | None:
        competition = match.get("competition")
        if not competition or not isinstance(competition, str):
            return None
        # RIMS competition names are the only stable league key RIMS exposes.
        key = competition
        if self._dataset.league_name(key):
            return key
        try:
            self._dataset.register_league(key, competition)
        except Exception as exc:
            print(f"[WARN] RIMS league register failed: {exc}", file=sys.stderr)
        return key

    def _is_rims_staff(self, entry: dict) -> bool:
        """True when a RIMS squad entry is coach/management staff, not a player."""
        label = (entry.get("positionLabel") or "").lower()
        role = (entry.get("role") or "").lower()
        return "coach" in label or "management" in role

    def _extract_rims_coach(self, team_data: dict) -> str | None:
        for entry in (team_data.get("teamList") or {}).get("list") or []:
            try:
                if not self._is_rims_staff(entry):
                    continue
                player = entry.get("player") or {}
                coach_id = str(player.get("id") or "")
                if not coach_id:
                    continue
                name = (
                    (player.get("name") or {}).get("display") or coach_id
                )
                self._dataset.register_coach(coach_id, name)
                return coach_id
            except Exception as exc:
                print(
                    f"[WARN] RIMS coach entry skipped: {exc}",
                    file=sys.stderr,
                )
        return None

    def _register_team_from_rims(
        self, team_id: int, team_data: dict, meta: dict
    ) -> None:
        if self._dataset.team_name(team_id):
            return
        try:
            # Try meta.name first, then fall back to RIMS_TEAM_NAMES mapping
            name = meta.get("name") or RIMS_TEAM_NAMES.get(str(team_id)) or str(team_id)
            # Map RIMS team ID to ESPN ID for colour lookup
            # RIMS_TEAM_IDS maps ESPN ID -> RIMS ID, so we need to reverse lookup
            espn_team_id = None
            for espn_id, rims_id in RIMS_TEAM_IDS.items():
                if rims_id == str(team_id):
                    espn_team_id = espn_id
                    break
            color = (
                (HOME_KIT_COLOURS.get(espn_team_id) if espn_team_id else None)
                or meta.get("color")
                or team_data.get("colour")
                or team_data.get("color")
            )
            if color and isinstance(color, str):
                color = "#" + color.lstrip("#")
            else:
                color = None
            alternate_color = (
                (SECONDARY_KIT_COLOURS.get(espn_team_id) if espn_team_id else None)
                or team_data.get("alternateColour")
            )
            if alternate_color and isinstance(alternate_color, str):
                alternate_color = "#" + alternate_color.lstrip("#")
            else:
                alternate_color = None
            # Extract abbreviation from RIMS naming array (team detail) or match meta.
            abbreviation = None
            naming = team_data.get("naming", [])
            if naming and isinstance(naming[0], dict):
                abbreviation = naming[0].get("abbr")
            if not abbreviation and isinstance(meta, dict):
                abbreviation = meta.get("abbreviation")
            self._dataset.register_team(
                team_id,
                name,
                color,
                alternate_color=alternate_color,
                abbreviation=abbreviation,
            )
        except Exception as exc:
            print(
                f"[WARN] RIMS team register failed for {team_id}: {exc}",
                file=sys.stderr,
            )

    def _register_player_from_rims(self, player_id: str, entry: dict) -> None:
        if self._dataset.player_name(player_id):
            return
        try:
            player = entry.get("player") or {}
            name = player.get("displayName") or str(player_id)
            name_data = player.get("name")
            if isinstance(name_data, dict):
                name = name_data.get("display") or name
            self._dataset.register_player(player_id, name)
        except Exception as exc:
            print(
                f"[WARN] RIMS player register failed for {player_id}: {exc}",
                file=sys.stderr,
            )

    # ---- negative cache: ESPN fallbacks confirmed to fail ----
    # Historical matches whose ESPN fallback has already been proven to fail are
    # recorded so we skip re-discovering/re-fetching them on every build. Two
    # tiers: a per-match negative (no ESPN event exists) and a per-event
    # negative (event exists but has no usable rugby lineup).
    _NEG_MATCH_PREFIX = "negative://espn-fallback/match/"
    _NEG_LINEUP_PREFIX = "negative://espn-fallback/lineup/"

    def _neg_match_key(self, match_id: str) -> str:
        return f"{self._NEG_MATCH_PREFIX}{match_id}"

    def _neg_lineup_key(self, event_id: str) -> str:
        return f"{self._NEG_LINEUP_PREFIX}{event_id}"

    def _is_neg_match(self, match_id: str) -> bool:
        return self._cache.get(self._neg_match_key(match_id)) is not None

    def _is_neg_lineup(self, event_id: str) -> bool:
        return self._cache.get(self._neg_lineup_key(event_id)) is not None

    def _record_neg_match(self, match_id: str, reason: str) -> None:
        self._cache.put(self._neg_match_key(match_id), {"reason": reason})

    def _record_neg_lineup(self, event_id: str, reason: str) -> None:
        self._cache.put(self._neg_lineup_key(event_id), {"reason": reason})

    # ---- negative cache: permanently-unresolvable matches ----
    # A match that is deterministically unresolvable (RIMS has no usable roster
    # and no ESPN fallback exists or completes) is recorded so a --skip-failed
    # run can omit it. Cleared by `dataset --reset`. Transient errors are NOT
    # recorded here (see the `unexpected` branch) so they stay retried.

    def _neg_fail_key(self, event_id: str) -> str:
        return f"{NEG_FAIL_PREFIX}{event_id}"

    def _is_terminal_fail(self, event_id: str) -> bool:
        return self._cache.get(self._neg_fail_key(event_id)) is not None

    def _record_terminal_fail(self, event_id: str, reason: str) -> None:
        self._cache.put(self._neg_fail_key(event_id), {"reason": reason})

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

    # ---- ESPN fallback ----

    def _fetch_game_espn_site_web(self, event_url: str) -> Game | None:
        """Build a full Game from the ESPN site web API `summary` response.

        Unlike the CORE API, this endpoint carries rugby rosters inline, so it
        is a complete source (teams, scores, and lineups) on its own.
        """
        path = self._espn_event_path(event_url)
        if path is None:
            return None
        league_id, event_id = path
        if self._is_neg_lineup(event_id):
            return None
        try:
            summary = self._espn_site_web_api.get_summary(league_id, event_id)
        except Exception as exc:
            print(
                f"[WARN] ESPN site web fetch failed for {event_url}: {exc}",
                file=sys.stderr,
            )
            return None
        try:
            competition = summary.get("header", {}).get("competitions", [{}])[0]
            scores_by_team = {
                int(c.get("id")): self._parse_site_web_score(c.get("score"))
                for c in competition.get("competitors", [])
            }
            competitors = []
            for roster_block in summary.get("rosters") or []:
                team = roster_block.get("team") or {}
                espn_team_id = int(team.get("id") or 0)
                team_id = self._to_rims_team_id(espn_team_id)
                self._register_team_from_site_web(team_id, team, espn_team_id)
                competitors.append(
                    Competitor(
                        team_id=team_id,
                        home=roster_block.get("homeAway") == "home",
                        score=scores_by_team.get(espn_team_id),
                        roster=self._parse_site_web_roster(
                            roster_block.get("roster") or []
                        ),
                    )
                )
            if not competitors:
                return None
            venue_id = self._register_venue_from_site_web(summary)
            league_id = self._register_league_from_site_web(summary)
            return Game(
                event_id=str(event_id),
                date=competition.get("date"),
                competitors=competitors,
                venue_id=venue_id,
                league_id=league_id,
            )
        except Exception as exc:
            print(
                f"[WARN] ESPN site web game parse failed: {exc}", file=sys.stderr
            )
            return None

    def _register_venue_from_site_web(self, summary: dict) -> str | None:
        venue = (summary.get("gameInfo") or {}).get("venue") or {}
        venue_id = venue.get("id")
        if not venue_id:
            return None
        # ESPN has no Opta crosswalk for venues; the ESPN id is used as-is.
        key = str(venue_id)
        if self._dataset.venue_name(key):
            return key
        try:
            self._dataset.register_venue(
                key,
                venue.get("fullName") or venue.get("shortName") or str(venue_id),
                city=venue.get("address", {}).get("city")
                if isinstance(venue.get("address"), dict)
                else None,
                country=venue.get("country")
                or (
                    venue.get("address", {}).get("country")
                    if isinstance(venue.get("address"), dict)
                    else None
                ),
            )
        except Exception as exc:
            print(f"[WARN] site web venue register failed: {exc}", file=sys.stderr)
        return key

    def _register_league_from_site_web(self, summary: dict) -> str | None:
        league = (summary.get("header") or {}).get("league") or {}
        league_id = league.get("id")
        if not league_id:
            return None
        # ESPN has no Opta crosswalk for leagues; the ESPN id is used as-is.
        key = str(league_id)
        if self._dataset.league_name(key):
            return key
        try:
            self._dataset.register_league(
                key,
                league.get("name") or str(league_id),
                abbreviation=league.get("abbreviation"),
            )
        except Exception as exc:
            print(f"[WARN] site web league register failed: {exc}", file=sys.stderr)
        return key

    def _parse_site_web_score(self, value) -> int | None:
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def _register_team_from_site_web(
        self, team_id: int, team: dict, espn_team_id: int | None = None
    ) -> None:
        if self._dataset.team_name(team_id):
            return
        try:
            name = team.get("displayName") or team.get("name") or str(team_id)
            # Curated kit colours are keyed by ESPN id; the canonical team id
            # is the RIMS/Opta id, so look colours up via the ESPN id when known.
            colour_key = str(espn_team_id) if espn_team_id is not None else str(team_id)
            color = HOME_KIT_COLOURS.get(colour_key) or team.get("color")
            if color and isinstance(color, str):
                color = "#" + color.lstrip("#")
            else:
                color = None
            alternate_color = (
                SECONDARY_KIT_COLOURS.get(colour_key) or team.get("alternateColor")
            )
            if alternate_color and isinstance(alternate_color, str):
                alternate_color = "#" + alternate_color.lstrip("#")
            else:
                alternate_color = None
            # ESPN team may have abbreviation field
            abbreviation = team.get("abbreviation")
            self._dataset.register_team(
                team_id,
                name,
                color,
                alternate_color=alternate_color,
                abbreviation=abbreviation,
            )
        except Exception as exc:
            print(
                f"[WARN] site web team register failed for {team_id}: {exc}",
                file=sys.stderr,
            )

    def _espn_event_path(self, event_url: str) -> tuple[str, str] | None:
        """Extract (league_id, event_id) from a CORE API event url."""
        m = re.search(r"/leagues/(\d+)/events/(\d+)", event_url)
        if not m:
            return None
        return m.group(1), m.group(2)

    def _to_rims_team_id(self, espn_team_id: int) -> int:
        """Map an ESPN team id to its canonical RIMS/Opta id where known."""
        mapped = RIMS_TEAM_IDS.get(str(espn_team_id))
        return int(mapped) if mapped else espn_team_id

    def _parse_site_web_roster(self, entries: list) -> list[RosterEntry]:
        roster: list[RosterEntry] = []
        for entry in entries:
            try:
                athlete = entry.get("athlete") or {}
                espn_player_id = str(athlete.get("id") or "")
                if not espn_player_id:
                    continue
                # ESPN and RIMS identifiers are not crosswalked. Matching their
                # display names would merge different people with the same name.
                player_id = espn_player_id
                self._register_player_from_site_web(espn_player_id, athlete)
                roster.append(
                    RosterEntry(
                        player_id=player_id,
                        jersey=self._parse_jersey(entry.get("jersey")),
                    )
                )
            except Exception as exc:
                print(
                    f"[WARN] site web roster entry skipped: {exc}", file=sys.stderr,
                )
        return roster

    def _register_player_from_site_web(self, player_id: str, athlete: dict) -> None:
        if self._dataset.player_name(player_id):
            return
        try:
            name = (
                athlete.get("displayName")
                or athlete.get("fullName")
                or str(player_id)
            )
            self._dataset.register_player(player_id, name)
        except Exception as exc:
            print(
                f"[WARN] site web player register failed for {player_id}: {exc}",
                file=sys.stderr,
            )

    def _parse_jersey(self, value) -> int:
        return int(value) if str(value).isdigit() else value

    # ---- reporting ----

    def _match_label(self, game: Game) -> str:
        date = (game.date or "")[:10]
        teams = " vs ".join(
            self._dataset.team_name(c.team_id) or f"team{c.team_id}"
            for c in game.competitors
        )
        return f"{date} {teams}".strip()

    def _report(self, listener, index: int, result: FetchResult) -> None:
        if not listener:
            return
        game = result.game
        if game is not None:
            label = self._match_label(game)
            activity = f"ok ({result.source})"
            complete = True
        elif result.partial is not None and result.partial.competitors:
            label = self._match_label(result.partial)
            activity = result.error or "unknown error"
            complete = False
            print(
                f"  [failed] {result.match_id}: {activity}", file=sys.stderr
            )
        else:
            label = f"match {result.match_id or '?'}"
            activity = result.error or "unknown error"
            complete = False
            print(
                f"  [failed] {result.match_id}: {activity}", file=sys.stderr
            )
        listener.event_fetched(index, label, activity, complete)

    def _print_failures(self, results: list[FetchResult]) -> None:
        completed = [r for r in results if r.game is not None]
        failed = [r for r in results if r.game is None]
        from_rims = sum(1 for r in completed if r.source == "rims")
        from_espn = sum(1 for r in completed if r.fell_back)
        print(
            f"  Completed: {len(completed)} "
            f"(RIMS: {from_rims}, ESPN fallback: {from_espn})",
            file=sys.stderr,
        )
        if not failed:
            return
        counts = Counter(r.error or "unknown" for r in failed)
        print(f"  Failed: {len(failed)}", file=sys.stderr)
        for reason, n in counts.most_common():
            print(f"    - {n}: {reason}", file=sys.stderr)

    def _print_summary(self, fetched: int, elapsed: float) -> None:
        _, rims_requests = self._rims_api.activity.snapshot()
        _, espn_requests = self._espn_api.activity.snapshot()
        _, site_web_requests = self._espn_site_web_api.activity.snapshot()
        total = rims_requests + espn_requests + site_web_requests
        print(
            f"[2/2] Done in {elapsed:.0f}s. "
            f"Wrote {len(self._dataset.games)} games "
            f"to {self._output_path}",
            file=sys.stderr,
        )
        print(
            f"      API requests: {total} "
            f"({rims_requests} RIMS, {espn_requests} ESPN core, "
            f"{site_web_requests} ESPN site, "
            f"{len(self._cache)} cache entries)",
            file=sys.stderr,
        )
