"""RIMS game fetch/parsing/registration helpers for dataset building."""

from __future__ import annotations

import sys

from .builder_base import BuilderBase
from .config import (
    HOME_KIT_COLOURS,
    RIMS_TEAM_IDS,
    RIMS_TEAM_NAMES,
    SECONDARY_KIT_COLOURS,
)
from .models import Competitor, Game, RosterEntry


class RimsGameMixin(BuilderBase):
    """RIMS game parsing and entity registration."""

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
                name = (player.get("name") or {}).get("display") or coach_id
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
                SECONDARY_KIT_COLOURS.get(espn_team_id) if espn_team_id else None
            ) or team_data.get("alternateColour")
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
