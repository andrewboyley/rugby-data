"""Orchestrates fetching a rugby dataset from the RIMS API (primary, ESPN fallback)."""

import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .api import EspnApi, event_id_from_url
from .build_cache import NegativeCacheMixin
from .build_discovery import BuildDiscoveryMixin
from .build_reporting import BuildReportingMixin
from .cache import ApiCache
from .config import (
    DEFAULT_MAX_WORKERS,
    DEFAULT_SAVE_EVERY,
    INTERNATIONAL_TEAM_IDS,
    RIMS_MAX_WORKERS,
    RIMS_TEAM_IDS,
    YEARS,
)
from .config import NEG_FAIL_PREFIX as NEG_FAIL_PREFIX
from .dataset import Dataset
from .espn_game import EspnGameMixin
from .espn_site_web_api import EspnSiteWebApi
from .game_fetch import FetchResult, GameFetchMixin
from .reporting import BuildListener
from .rims_api import RimsApi
from .rims_game import RimsGameMixin


class DatasetBuilder(
    NegativeCacheMixin,
    RimsGameMixin,
    EspnGameMixin,
    GameFetchMixin,
    BuildDiscoveryMixin,
    BuildReportingMixin,
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

    def build(
        self,
        listener: BuildListener | None = None,
        skip_failed: bool = False,
    ) -> None:
        for game in self._dataset.games:
            self._cache.mark_processed(game.event_id)

        event_urls = self._discover_event_urls()
        pending = [
            u for u in event_urls if not self._cache.is_processed(event_id_from_url(u))
        ]
        if skip_failed:
            skipped = [
                u for u in pending if self._is_terminal_fail(event_id_from_url(u))
            ]
            if skipped:
                pending = [
                    u
                    for u in pending
                    if not self._is_terminal_fail(event_id_from_url(u))
                ]
                print(
                    f"[skip] {len(skipped)} previously-failed matches (--skip-failed)",
                    file=sys.stderr,
                )

        print(
            f"[1/2] Found {len(event_urls)} events, {len(pending)} to fetch\n",
            file=sys.stderr,
        )

        if listener:
            listener.task_started(len(pending))

        t0 = time.time()
        results: list[FetchResult] = []
        with ThreadPoolExecutor(max_workers=self._max_workers) as pool:
            future_to_url = {pool.submit(self._fetch_game, u): u for u in pending}
            for i, future in enumerate(as_completed(future_to_url), 1):
                event_url = future_to_url[future]
                result = future.result()
                results.append(result)
                game = result.game
                if game is not None and game.is_complete():
                    self._cache.mark_processed(event_id_from_url(event_url))
                    self._dataset.merge([game])
                self._report(listener, i, result)
                if i % self._save_every == 0 or i == len(pending):
                    self._dataset.save(self._output_path)
                    # Only rewrite the cache if a real network fetch added a
                    # response this run; on a from-cache rebuild nothing was
                    # fetched, so a soft save is a no-op (avoids rewriting the
                    # multi-MB cache file needlessly).
                    self._cache.save()

        self._dataset.save(self._output_path)
        self._cache.save(force=True)
        if listener:
            listener.task_finished()

        elapsed = time.time() - t0
        self._print_summary(len(pending), elapsed)
        self._print_failures(results)
