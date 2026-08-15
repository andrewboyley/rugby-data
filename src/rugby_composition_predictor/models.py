"""Domain models for rugby matches."""

from dataclasses import dataclass, field


@dataclass
class RosterEntry:
    player_id: str
    jersey: int | None


@dataclass
class Competitor:
    team_id: int
    home: bool
    score: int | None
    roster: list[RosterEntry] = field(default_factory=list)
    coach_id: str | None = None

    def is_complete(self) -> bool:
        return bool(self.roster) and self.score is not None


@dataclass
class Game:
    event_id: str
    date: str | None
    competitors: list[Competitor] = field(default_factory=list)
    venue_id: str | None = None
    league_id: str | None = None

    def is_complete(self) -> bool:
        return len(self.competitors) == 2 and all(
            c.is_complete() for c in self.competitors
        )


def roster_from_dict(data: dict) -> RosterEntry:
    return RosterEntry(
        player_id=str(data["playerId"]),
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
        coach_id=data.get("coachId"),
    )


def competitor_to_dict(comp: Competitor) -> dict:
    return {
        "teamId": comp.team_id,
        "home": comp.home,
        "score": comp.score,
        "roster": [roster_to_dict(e) for e in comp.roster],
        "coachId": comp.coach_id,
    }


def game_from_dict(data: dict) -> Game:
    return Game(
        event_id=str(data["eventId"]),
        date=data.get("date"),
        competitors=[competitor_from_dict(c) for c in data.get("competitors", [])],
        venue_id=data.get("venueId"),
        league_id=data.get("leagueId"),
    )


def game_to_dict(game: Game) -> dict:
    return {
        "eventId": game.event_id,
        "date": game.date,
        "competitors": [competitor_to_dict(c) for c in game.competitors],
        "venueId": game.venue_id,
        "leagueId": game.league_id,
    }


def _parse_jersey(value) -> int | None:
    """Jerseys arrive as numeric strings, but guard against odd values."""
    if value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None
