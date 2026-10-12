"""Domain models for rugby matches."""

from typing import ClassVar

from pydantic import BaseModel, ConfigDict, Field


class _Model(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    _positional_fields: ClassVar[tuple[str, ...]] = ()

    def __init__(self, *args: object, **data: object) -> None:
        if len(args) > len(self._positional_fields):
            raise TypeError(
                f"expected at most {len(self._positional_fields)} positional arguments"
            )
        data = dict(zip(self._positional_fields, args, strict=False)) | data
        super().__init__(**data)


class RosterEntry(_Model):
    _positional_fields = ("player_id", "jersey")

    player_id: str = Field(alias="playerId")
    jersey: int | None


class Competitor(_Model):
    _positional_fields = ("team_id", "home", "score", "roster", "coach_id")

    team_id: int = Field(alias="teamId")
    home: bool
    score: int | None
    roster: list[RosterEntry] = Field(default_factory=list)
    coach_id: str | None = Field(default=None, alias="coachId")

    def is_complete(self) -> bool:
        return (
            bool(self.roster)
            and self.score is not None
            and all(entry.player_id for entry in self.roster)
        )


class Game(_Model):
    _positional_fields = ("event_id", "date", "competitors", "venue_id", "league_id")

    event_id: str = Field(alias="eventId")
    date: str | None
    competitors: list[Competitor] = Field(default_factory=list)
    venue_id: str | None = Field(default=None, alias="venueId")
    league_id: str | None = Field(default=None, alias="leagueId")

    def is_complete(self) -> bool:
        return len(self.competitors) == 2 and all(
            competitor.is_complete() for competitor in self.competitors
        )


def roster_from_dict(data: dict) -> RosterEntry | None:
    player_id = str(data.get("playerId") or "").strip()
    if not player_id:
        return None
    return RosterEntry(player_id=player_id, jersey=_parse_jersey(data["jersey"]))


def roster_to_dict(entry: RosterEntry) -> dict:
    return entry.model_dump(by_alias=True)


def competitor_from_dict(data: dict) -> Competitor:
    roster = [roster_from_dict(entry) for entry in data.get("roster", [])]
    return Competitor(
        team_id=int(data["teamId"]),
        home=bool(data["home"]),
        score=data["score"],
        roster=[entry for entry in roster if entry is not None],
        coach_id=data.get("coachId"),
    )


def competitor_to_dict(comp: Competitor) -> dict:
    return comp.model_dump(by_alias=True)


def game_from_dict(data: dict) -> Game:
    return Game(
        event_id=data["eventId"],
        date=data.get("date"),
        competitors=[
            competitor_from_dict(comp) for comp in data.get("competitors", [])
        ],
        venue_id=data.get("venueId"),
        league_id=data.get("leagueId"),
    )


def game_to_dict(game: Game) -> dict:
    return game.model_dump(by_alias=True)


def _parse_jersey(value: object) -> int | None:
    if not isinstance(value, str | bytes | bytearray | int | float):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
