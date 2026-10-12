"""RIMS game fetch and parsing helpers for dataset building."""

from __future__ import annotations

import sys

from .builder_base import BuilderBase
from .models import Competitor, Game, RosterEntry


class RimsGameMixin(BuilderBase):
    """Fetch and parse a single RIMS match into a :class:`~models.Game`."""

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
                return None
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

    def _is_rims_staff(self, entry: dict) -> bool:
        """True when a RIMS squad entry is coach/management staff, not a player."""
        label = (entry.get("positionLabel") or "").lower()
        role = (entry.get("role") or "").lower()
        return "coach" in label or "management" in role

    def _extract_rims_coach(self, team_data: dict) -> str | None:
        for entry in (team_data.get("teamList") or {}).get("list") or []:
            try:
                coach_id = self._coach_id_from_entry(entry)
                if coach_id is not None:
                    return coach_id
            except Exception as exc:
                print(
                    f"[WARN] RIMS coach entry skipped: {exc}",
                    file=sys.stderr,
                )
        return None

    def _coach_id_from_entry(self, entry: dict) -> str | None:
        if not self._is_rims_staff(entry):
            return None
        player = entry.get("player") or {}
        coach_id = str(player.get("id") or "")
        if not coach_id:
            return None
        name = (player.get("name") or {}).get("display") or coach_id
        self._dataset.register_coach(coach_id, name)
        return coach_id
