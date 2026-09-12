"""Dataset model: a collection of games plus team/player name registries."""

import threading
from pathlib import Path

from .models import Game, game_from_dict, game_to_dict
from .storage import atomic_write_json, load_json


class Dataset:
    def __init__(
        self,
        games: list[Game] | None = None,
        teams: dict[int, dict] | None = None,
        players: dict[str, str] | None = None,
        venues: dict[str, dict] | None = None,
        leagues: dict[str, dict] | None = None,
        coaches: dict[str, str] | None = None,
    ):
        self.games = games or []
        self.teams = teams or {}
        self.players = players or {}
        self.venues = venues or {}
        self.leagues = leagues or {}
        self.coaches = coaches or {}
        self._lock = threading.Lock()

    @classmethod
    def load(cls, path: Path) -> "Dataset":
        data = load_json(path)
        if not data:
            return cls()
        raw_teams = data.get("teams", {})
        teams: dict[int, dict] = {}
        for k, v in raw_teams.items():
            tid = int(k)
            if isinstance(v, dict):
                teams[tid] = v
            else:
                teams[tid] = {"name": str(v), "color": None}
        return cls(
            games=[game_from_dict(g) for g in data.get("games", [])],
            teams=teams,
            players={str(k): v for k, v in data.get("players", {}).items()},
            venues={str(k): v for k, v in data.get("venues", {}).items()},
            leagues={str(k): v for k, v in data.get("leagues", {}).items()},
            coaches={str(k): v for k, v in data.get("coaches", {}).items()},
        )

    def save(self, path: Path) -> None:
        with self._lock:
            teams = dict(self.teams)
            players = dict(self.players)
            venues = dict(self.venues)
            leagues = dict(self.leagues)
            coaches = dict(self.coaches)
        payload = {
            "games": [game_to_dict(g) for g in self.games],
            "teams": teams,
            "players": players,
            "venues": venues,
            "leagues": leagues,
            "coaches": coaches,
        }
        atomic_write_json(path, payload)

    def complete_games(self) -> list[Game]:
        return [g for g in self.games if g.is_complete()]

    def merge(self, games: list[Game]) -> None:
        """Add games, deduping by event id and keeping only complete ones."""
        merged = {g.event_id: g for g in self.games}
        for game in games:
            merged[game.event_id] = game
        self.games = sorted(
            (g for g in merged.values() if g.is_complete()),
            key=lambda g: g.date or "",
        )

    def team_name(self, team_id: int) -> str | None:
        entry = self.teams.get(team_id)
        if isinstance(entry, dict):
            return entry.get("name")
        return entry if isinstance(entry, str) else None

    def team_color(self, team_id: int) -> str | None:
        entry = self.teams.get(team_id)
        if isinstance(entry, dict):
            return entry.get("color")
        return None

    def register_team(
        self,
        team_id: int,
        name: str,
        color: str | None = None,
        alternate_color: str | None = None,
        abbreviation: str | None = None,
    ) -> None:
        with self._lock:
            self.teams[team_id] = {
                "name": name,
                "color": color,
                "alternateColor": alternate_color,
                "abbreviation": abbreviation,
            }

    def player_name(self, player_id: str) -> str | None:
        return self.players.get(player_id)

    def register_player(self, player_id: str, name: str) -> None:
        with self._lock:
            self.players[player_id] = name

    # ---- venues ----

    def venue_name(self, venue_id: str) -> str | None:
        entry = self.venues.get(venue_id)
        if isinstance(entry, dict):
            return entry.get("name")
        return entry if isinstance(entry, str) else None

    def register_venue(
        self,
        venue_id: str,
        name: str,
        city: str | None = None,
        country: str | None = None,
    ) -> None:
        with self._lock:
            self.venues[venue_id] = {
                "name": name,
                "city": city,
                "country": country,
            }

    # ---- leagues ----

    def league_name(self, league_id: str) -> str | None:
        entry = self.leagues.get(league_id)
        if isinstance(entry, dict):
            return entry.get("name")
        return entry if isinstance(entry, str) else None

    def register_league(
        self,
        league_id: str,
        name: str,
        abbreviation: str | None = None,
    ) -> None:
        with self._lock:
            self.leagues[league_id] = {
                "name": name,
                "abbreviation": abbreviation,
            }

    # ---- coaches ----

    def coach_name(self, coach_id: str) -> str | None:
        return self.coaches.get(coach_id)

    def register_coach(self, coach_id: str, name: str) -> None:
        with self._lock:
            self.coaches[coach_id] = name
