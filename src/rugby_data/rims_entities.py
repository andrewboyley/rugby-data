"""RIMS entity registration helpers (venues, leagues, teams, players)."""

from __future__ import annotations

import sys

from .builder_base import BuilderBase
from .config import (
    HOME_KIT_COLOURS,
    RIMS_TEAM_IDS,
    RIMS_TEAM_NAMES,
    SECONDARY_KIT_COLOURS,
)


class RimsEntityMixin(BuilderBase):
    """Register RIMS venues, leagues, teams, and players on the dataset."""

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

    def _register_team_from_rims(
        self, team_id: int, team_data: dict, meta: dict
    ) -> None:
        if self._dataset.team_name(team_id):
            return
        try:
            espn_team_id = self._reverse_espn_team_id(team_id)
            color, alternate_color = self._rims_team_colours(
                team_data, meta, espn_team_id
            )
            self._dataset.register_team(
                team_id,
                self._rims_team_name(team_id, meta),
                color,
                alternate_color=alternate_color,
                abbreviation=self._rims_team_abbreviation(team_data, meta),
            )
        except Exception as exc:
            print(
                f"[WARN] RIMS team register failed for {team_id}: {exc}",
                file=sys.stderr,
            )

    def _rims_team_name(self, team_id: int, meta: dict) -> str:
        # Try meta.name first, then fall back to RIMS_TEAM_NAMES mapping.
        return meta.get("name") or RIMS_TEAM_NAMES.get(str(team_id)) or str(team_id)

    def _rims_team_colours(
        self, team_data: dict, meta: dict, espn_team_id: str | None
    ) -> tuple[str | None, str | None]:
        primary = (
            (HOME_KIT_COLOURS.get(espn_team_id) if espn_team_id else None)
            or meta.get("color")
            or team_data.get("colour")
            or team_data.get("color")
        )
        alternate = (
            SECONDARY_KIT_COLOURS.get(espn_team_id) if espn_team_id else None
        ) or team_data.get("alternateColour")
        return self._normalise_colour(primary), self._normalise_colour(alternate)

    def _reverse_espn_team_id(self, team_id: int) -> str | None:
        for espn_id, rims_id in RIMS_TEAM_IDS.items():
            if rims_id == str(team_id):
                return espn_id
        return None

    def _normalise_colour(self, value) -> str | None:
        if value and isinstance(value, str):
            return "#" + value.lstrip("#")
        return None

    def _rims_team_abbreviation(self, team_data: dict, meta: dict) -> str | None:
        abbreviation = None
        naming = team_data.get("naming", [])
        if naming and isinstance(naming[0], dict):
            abbreviation = naming[0].get("abbr")
        if not abbreviation and isinstance(meta, dict):
            abbreviation = meta.get("abbreviation")
        return abbreviation

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
