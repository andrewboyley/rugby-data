"""ESPN site web game fetch/parsing/registration helpers."""

from __future__ import annotations

import re
import sys

from .builder_base import BuilderBase
from .config import (
    HOME_KIT_COLOURS,
    RIMS_TEAM_IDS,
    SECONDARY_KIT_COLOURS,
)
from .models import Competitor, Game, RosterEntry


class EspnGameMixin(BuilderBase):
    """ESPN site web parsing and entity registration."""

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
            scores_by_team = self._site_web_scores(competition)
            competitors = self._site_web_competitors(summary, scores_by_team)
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
            print(f"[WARN] ESPN site web game parse failed: {exc}", file=sys.stderr)
            return None

    def _site_web_scores(self, competition: dict) -> dict:
        return {
            int(c.get("id")): self._parse_site_web_score(c.get("score"))
            for c in competition.get("competitors", [])
        }

    def _site_web_competitors(
        self, summary: dict, scores_by_team: dict
    ) -> list[Competitor]:
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
        return competitors

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
            name, city, country = self._venue_details(venue, key)
            self._dataset.register_venue(key, name, city=city, country=country)
        except Exception as exc:
            print(f"[WARN] site web venue register failed: {exc}", file=sys.stderr)
        return key

    def _venue_details(
        self, venue: dict, key: str
    ) -> tuple[str, str | None, str | None]:
        address = venue.get("address")
        if not isinstance(address, dict):
            address = {}
        name = venue.get("fullName") or venue.get("shortName") or key
        return name, address.get("city"), venue.get("country") or address.get("country")

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
            # Curated kit colours are keyed by ESPN id; the canonical team id
            # is the RIMS/Opta id, so look colours up via the ESPN id when known.
            colour_key = str(espn_team_id) if espn_team_id is not None else str(team_id)
            color, alternate_color = self._site_web_team_colours(team, colour_key)
            self._dataset.register_team(
                team_id,
                team.get("displayName") or team.get("name") or str(team_id),
                color,
                alternate_color=alternate_color,
                abbreviation=team.get("abbreviation"),
            )
        except Exception as exc:
            print(
                f"[WARN] site web team register failed for {team_id}: {exc}",
                file=sys.stderr,
            )

    def _site_web_team_colours(
        self, team: dict, colour_key: str
    ) -> tuple[str | None, str | None]:
        color = HOME_KIT_COLOURS.get(colour_key) or team.get("color")
        alternate_color = SECONDARY_KIT_COLOURS.get(colour_key) or team.get(
            "alternateColor"
        )
        return self._normalise_colour(color), self._normalise_colour(alternate_color)

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
                    f"[WARN] site web roster entry skipped: {exc}",
                    file=sys.stderr,
                )
        return roster

    def _register_player_from_site_web(self, player_id: str, athlete: dict) -> None:
        if self._dataset.player_name(player_id):
            return
        try:
            name = (
                athlete.get("displayName") or athlete.get("fullName") or str(player_id)
            )
            self._dataset.register_player(player_id, name)
        except Exception as exc:
            print(
                f"[WARN] site web player register failed for {player_id}: {exc}",
                file=sys.stderr,
            )

    def _parse_jersey(self, value) -> int:
        return int(value) if str(value).isdigit() else value
