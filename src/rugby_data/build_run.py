"""Dataset build run loop: discovery, concurrent fetch, and incremental saves."""

from __future__ import annotations

import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from .api import event_id_from_url
from .builder_base import BuilderBase
from .game_fetch import FetchResult
from .reporting import BuildListener


class BuildRunMixin(BuilderBase):
    """Drive discovery, concurrent fetching, and incremental persistence."""

    def build(
        self,
        listener: BuildListener | None = None,
        skip_failed: bool = False,
    ) -> None:
        self._mark_existing_processed()

        event_urls = self._discover_event_urls()
        pending = self._select_pending(event_urls, skip_failed)

        print(
            f"[1/2] Found {len(event_urls)} events, {len(pending)} to fetch\n",
            file=sys.stderr,
        )

        if listener:
            listener.task_started(len(pending))

        t0 = time.time()
        results = self._run_fetch(pending, listener)

        self._dataset.save(self._output_path)
        self._cache.save(force=True)
        if listener:
            listener.task_finished()

        elapsed = time.time() - t0
        self._print_summary(len(pending), elapsed)
        self._print_failures(results)

    def _mark_existing_processed(self) -> None:
        for game in self._dataset.games:
            self._cache.mark_processed(game.event_id)

    def _select_pending(self, event_urls: list[str], skip_failed: bool) -> list[str]:
        pending = [
            u for u in event_urls if not self._cache.is_processed(event_id_from_url(u))
        ]
        if skip_failed:
            pending = self._drop_terminal_failures(pending)
        return pending

    def _drop_terminal_failures(self, pending: list[str]) -> list[str]:
        skipped = [u for u in pending if self._is_terminal_fail(event_id_from_url(u))]
        if not skipped:
            return pending
        print(
            f"[skip] {len(skipped)} previously-failed matches (--skip-failed)",
            file=sys.stderr,
        )
        return [u for u in pending if not self._is_terminal_fail(event_id_from_url(u))]

    def _run_fetch(
        self,
        pending: list[str],
        listener: BuildListener | None,
    ) -> list[FetchResult]:
        results: list[FetchResult] = []
        with ThreadPoolExecutor(max_workers=self._max_workers) as pool:
            future_to_url = {pool.submit(self._fetch_game, u): u for u in pending}
            for i, future in enumerate(as_completed(future_to_url), 1):
                event_url = future_to_url[future]
                result = future.result()
                results.append(result)
                self._merge_complete(event_url, result)
                self._report(listener, i, result)
                if i % self._save_every == 0 or i == len(pending):
                    self._dataset.save(self._output_path)
                    # Only rewrite the cache if a real network fetch added a
                    # response this run; on a from-cache rebuild nothing was
                    # fetched, so a soft save is a no-op (avoids rewriting the
                    # multi-MB cache file needlessly).
                    self._cache.save()
        return results

    def _merge_complete(self, event_url: str, result: FetchResult) -> None:
        game = result.game
        if game is not None and game.is_complete():
            self._cache.mark_processed(event_id_from_url(event_url))
            self._dataset.merge([game])
