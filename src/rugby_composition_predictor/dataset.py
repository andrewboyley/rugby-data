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
        players: dict[int, str] | None = None,
    ):
        self.games = games or []
        self.teams = teams or {}
        self.players = players or {}
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
            players={int(k): v for k, v in data.get("players", {}).items()},
        )

    def save(self, path: Path) -> None:
        with self._lock:
            teams = dict(self.teams)
            players = dict(self.players)
        payload = {
            "games": [game_to_dict(g) for g in self.games],
            "teams": teams,
            "players": players,
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

    def register_team(self, team_id: int, name: str, color: str | None = None) -> None:
        with self._lock:
            self.teams[team_id] = {"name": name, "color": color}

    def player_name(self, player_id: int) -> str | None:
        return self.players.get(player_id)

    def register_player(self, player_id: int, name: str) -> None:
        with self._lock:
            self.players[player_id] = name
