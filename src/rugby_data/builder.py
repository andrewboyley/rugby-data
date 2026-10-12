"""Orchestrates fetching a rugby dataset from the RIMS API (primary, ESPN fallback).

``DatasetBuilder`` is intentionally thin: it wires dependencies in ``__init__``
and composes the focused mixins that implement discovery, fetching, parsing,
reporting, and persistence.
"""

from __future__ import annotations

from pathlib import Path

from .api import EspnApi
from .build_cache import NegativeCacheMixin
from .build_discovery import BuildDiscoveryMixin
from .build_reporting import BuildReportingMixin
from .build_run import BuildRunMixin
from .cache import ApiCache
from .config import (
    DEFAULT_MAX_WORKERS,
    DEFAULT_SAVE_EVERY,
    INTERNATIONAL_TEAM_IDS,
    RIMS_MAX_WORKERS,
    RIMS_TEAM_IDS,
    YEARS,
)
from .config import (
    NEG_FAIL_PREFIX as NEG_FAIL_PREFIX,
)
from .dataset import Dataset
from .espn_game import EspnGameMixin
from .espn_site_web_api import EspnSiteWebApi
from .game_fetch import GameFetchMixin
from .rims_api import RimsApi
from .rims_entities import RimsEntityMixin
from .rims_game import RimsGameMixin


class DatasetBuilder(
    NegativeCacheMixin,
    RimsGameMixin,
    RimsEntityMixin,
    EspnGameMixin,
    GameFetchMixin,
    BuildDiscoveryMixin,
    BuildReportingMixin,
    BuildRunMixin,
):
    def __init__(
        self,
        rims_api: RimsApi,
        espn_api: EspnApi,
        cache: ApiCache,
        dataset: Dataset,
        output_path: Path,
        *,
        team_ids: list[str] | None = None,
        years=YEARS,
        max_workers: int = DEFAULT_MAX_WORKERS,
        save_every: int = DEFAULT_SAVE_EVERY,
        source: str = "rims-first",
    ):
        self._rims_api = rims_api
        self._espn_api = espn_api
        self._espn_site_web_api = EspnSiteWebApi(cache)
        self._cache = cache
        self._dataset = dataset
        self._output_path = output_path
        self._team_ids = team_ids if team_ids is not None else INTERNATIONAL_TEAM_IDS
        self._years = years
        self._max_workers = max_workers
        self._save_every = save_every
        self._requests = 0
        self._source = source
        self._espn_fallback_map: dict[str, str] = {}
        self._rims_match_data: dict[str, tuple[str, list[str]]] = {}
        self._espn_event_cache: dict[str, dict] = {}
        self._RIMS_TO_ESPN = {v: k for k, v in RIMS_TEAM_IDS.items()}
        if source in ("rims-first", "rims"):
            self._max_workers = min(self._max_workers, RIMS_MAX_WORKERS)

    def close(self) -> None:
        self._rims_api.close()
        self._espn_api.close()
        self._espn_site_web_api.close()
