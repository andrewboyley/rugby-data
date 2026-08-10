"""Domain models for rugby matches."""

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class RosterEntry:
    player_id: int
    jersey: int


@dataclass
class Competitor:
    team_id: int
    home: bool
    score: Optional[int]
    roster: List[RosterEntry] = field(default_factory=list)

    def is_complete(self) -> bool:
        return bool(self.roster) and self.score is not None


@dataclass
class Game:
    event_id: int
    date: Optional[str]
    competitors: List[Competitor] = field(default_factory=list)

    def is_complete(self) -> bool:
        return (
            len(self.competitors) == 2
            and all(c.is_complete() for c in self.competitors)
        )


def roster_from_dict(data: dict) -> RosterEntry:
    return RosterEntry(
        player_id=int(data["playerId"]),
        jersey=_parse_jersey(data["jersey"]),
    )


def roster_to_dict(entry: RosterEntry) -> dict:
    return {"playerId": entry.player_id, "jersey": entry.jersey}


def competitor_from_dict(data: dict) -> Competitor:
    return Competitor(
        team_id=int(data["teamId"]),
        home=bool(data["home"]),
        score=data["score"],
        roster=[roster_from_dict(e) for e in data.get("roster", [])],
    )


def competitor_to_dict(comp: Competitor) -> dict:
    return {
        "teamId": comp.team_id,
        "home": comp.home,
        "score": comp.score,
        "roster": [roster_to_dict(e) for e in comp.roster],
    }


def game_from_dict(data: dict) -> Game:
    return Game(
        event_id=int(data["eventId"]),
        date=data.get("date"),
        competitors=[competitor_from_dict(c) for c in data.get("competitors", [])],
    )


def game_to_dict(game: Game) -> dict:
    return {
        "eventId": game.event_id,
        "date": game.date,
        "competitors": [competitor_to_dict(c) for c in game.competitors],
    }


def _parse_jersey(value) -> int:
    """Jerseys arrive as numeric strings, but guard against odd values."""
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    raise ValueError(f"cannot parse jersey {value!r}")
