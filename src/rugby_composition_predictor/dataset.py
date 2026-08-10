"""Dataset model: a collection of games plus team/player name registries."""

from pathlib import Path
from typing import Dict, List, Optional

from .models import Game, game_from_dict, game_to_dict
from .storage import atomic_write_json, load_json


class Dataset:
    def __init__(
        self,
        games: Optional[List[Game]] = None,
        teams: Optional[Dict[int, str]] = None,
        players: Optional[Dict[int, str]] = None,
    ):
        self.games = games or []
        self.teams = teams or {}
        self.players = players or {}

    @classmethod
    def load(cls, path: Path) -> "Dataset":
        data = load_json(path)
        if not data:
            return cls()
        return cls(
            games=[game_from_dict(g) for g in data.get("games", [])],
            teams={int(k): v for k, v in data.get("teams", {}).items()},
            players={int(k): v for k, v in data.get("players", {}).items()},
        )

    def save(self, path: Path) -> None:
        payload = {
            "games": [game_to_dict(g) for g in self.games],
            "teams": self.teams,
            "players": self.players,
        }
        atomic_write_json(path, payload)

    def complete_games(self) -> List[Game]:
        return [g for g in self.games if g.is_complete()]

    def merge(self, games: List[Game]) -> None:
        """Add games, deduping by event id and keeping only complete ones."""
        merged = {g.event_id: g for g in self.games}
        for game in games:
            merged[game.event_id] = game
        self.games = sorted(
            (g for g in merged.values() if g.is_complete()),
            key=lambda g: g.date or "",
        )

    def team_name(self, team_id: int) -> Optional[str]:
        return self.teams.get(team_id)

    def register_team(self, team_id: int, name: str) -> None:
        self.teams[team_id] = name

    def player_name(self, player_id: int) -> Optional[str]:
        return self.players.get(player_id)

    def register_player(self, player_id: int, name: str) -> None:
        self.players[player_id] = name
