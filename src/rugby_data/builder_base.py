"""Shared context for the dataset builder mixins.

Declares the attributes and cross-mixin helper signatures so each mixin can be
type-checked in isolation, while ``DatasetBuilder`` composes the concrete
implementations at runtime.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import TYPE_CHECKING

from .api import EspnApi
from .cache import ApiCache
from .dataset import Dataset
from .espn_site_web_api import EspnSiteWebApi
from .models import RosterEntry
from .rims_api import RimsApi

if TYPE_CHECKING:
    from collections.abc import Iterable

    from .game_fetch import FetchResult
    from .models import Game


class BuilderBase(ABC):
    """Attribute and method surface shared by the builder mixins."""

    _rims_api: RimsApi
    _espn_api: EspnApi
    _espn_site_web_api: EspnSiteWebApi
    _cache: ApiCache
    _dataset: Dataset
    _output_path: Path
    _team_ids: list[str]
    _years: Iterable[int]
    _max_workers: int
    _save_every: int
    _requests: int
    _source: str
    _espn_fallback_map: dict[str, str]
    _rims_match_data: dict[str, tuple[str, list[str]]]
    _espn_event_cache: dict[str, dict]
    _RIMS_TO_ESPN: dict[str, str]
    _NEG_MATCH_PREFIX: str
    _NEG_LINEUP_PREFIX: str

    # RIMS game parsing
    @abstractmethod
    def _fetch_rims(self, match_id: str) -> dict: ...
    @abstractmethod
    def _game_from_rims(self, summary: dict) -> Game: ...
    @abstractmethod
    def _extract_rims_score(self, match_data: dict, home: bool) -> int | None: ...
    @abstractmethod
    def _fetch_rims_roster(self, team_data: dict) -> list[RosterEntry]: ...
    @abstractmethod
    def _register_venue_from_rims(self, match: dict) -> str | None: ...
    @abstractmethod
    def _register_league_from_rims(self, match: dict) -> str | None: ...
    @abstractmethod
    def _is_rims_staff(self, entry: dict) -> bool: ...
    @abstractmethod
    def _extract_rims_coach(self, team_data: dict) -> str | None: ...
    @abstractmethod
    def _register_team_from_rims(
        self, team_id: int, team_data: dict, meta: dict
    ) -> None: ...
    @abstractmethod
    def _register_player_from_rims(self, player_id: str, entry: dict) -> None: ...

    # ESPN site web parsing
    @abstractmethod
    def _fetch_game_espn_site_web(self, event_url: str) -> Game | None: ...
    @abstractmethod
    def _register_venue_from_site_web(self, summary: dict) -> str | None: ...
    @abstractmethod
    def _register_league_from_site_web(self, summary: dict) -> str | None: ...
    @abstractmethod
    def _parse_site_web_score(self, value) -> int | None: ...
    @abstractmethod
    def _register_team_from_site_web(
        self, team_id: int, team: dict, espn_team_id: int | None = None
    ) -> None: ...
    @abstractmethod
    def _espn_event_path(self, event_url: str) -> tuple[str, str] | None: ...
    @abstractmethod
    def _to_rims_team_id(self, espn_team_id: int) -> int: ...
    @abstractmethod
    def _parse_site_web_roster(self, entries: list) -> list[RosterEntry]: ...
    @abstractmethod
    def _register_player_from_site_web(self, player_id: str, athlete: dict) -> None: ...
    @abstractmethod
    def _parse_jersey(self, value) -> int: ...

    # Primary fetch
    @abstractmethod
    def _fetch_game(self, event_url: str) -> FetchResult: ...
    @abstractmethod
    def _get_espn_fallback_url(self, match_id: str) -> str | None: ...

    # Discovery
    @abstractmethod
    def _discover_event_urls(self) -> list[str]: ...

    # Reporting
    @abstractmethod
    def _match_label(self, game: Game) -> str: ...
    @abstractmethod
    def _report(self, listener, index: int, result: FetchResult) -> None: ...
    @abstractmethod
    def _print_failures(self, results: list[FetchResult]) -> None: ...
    @abstractmethod
    def _print_summary(self, fetched: int, elapsed: float) -> None: ...

    # Negative cache
    @abstractmethod
    def _neg_match_key(self, match_id: str) -> str: ...
    @abstractmethod
    def _neg_lineup_key(self, event_id: str) -> str: ...
    @abstractmethod
    def _is_neg_match(self, match_id: str) -> bool: ...
    @abstractmethod
    def _is_neg_lineup(self, event_id: str) -> bool: ...
    @abstractmethod
    def _record_neg_match(self, match_id: str, reason: str) -> None: ...
    @abstractmethod
    def _record_neg_lineup(self, event_id: str, reason: str) -> None: ...
    @abstractmethod
    def _neg_fail_key(self, event_id: str) -> str: ...
    @abstractmethod
    def _is_terminal_fail(self, event_id: str) -> bool: ...
    @abstractmethod
    def _record_terminal_fail(self, event_id: str, reason: str) -> None: ...

    # Shared helpers
    @abstractmethod
    def _normalise_colour(self, value) -> str | None: ...
