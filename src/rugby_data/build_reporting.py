"""Build progress reporting helpers."""

from __future__ import annotations

import sys
from collections import Counter

from .builder_base import BuilderBase
from .game_fetch import FetchResult
from .models import Game


class BuildReportingMixin(BuilderBase):
    """Print and report build progress."""

    def _match_label(self, game: Game) -> str:
        date = (game.date or "")[:10]
        teams = " vs ".join(
            self._dataset.team_name(c.team_id) or f"team{c.team_id}"
            for c in game.competitors
        )
        return f"{date} {teams}".strip()

    def _report(self, listener, index: int, result: FetchResult) -> None:
        if not listener:
            return
        game = result.game
        if game is not None:
            label = self._match_label(game)
            activity = f"ok ({result.source})"
            complete = True
        elif result.partial is not None and result.partial.competitors:
            label = self._match_label(result.partial)
            activity = result.error or "unknown error"
            complete = False
            print(f"  [failed] {result.match_id}: {activity}", file=sys.stderr)
        else:
            label = f"match {result.match_id or '?'}"
            activity = result.error or "unknown error"
            complete = False
            print(f"  [failed] {result.match_id}: {activity}", file=sys.stderr)
        listener.event_fetched(index, label, activity, complete)

    def _print_failures(self, results: list[FetchResult]) -> None:
        completed = [r for r in results if r.game is not None]
        failed = [r for r in results if r.game is None]
        from_rims = sum(1 for r in completed if r.source == "rims")
        from_espn = sum(1 for r in completed if r.fell_back)
        print(
            f"  Completed: {len(completed)} "
            f"(RIMS: {from_rims}, ESPN fallback: {from_espn})",
            file=sys.stderr,
        )
        if not failed:
            return
        counts = Counter(r.error or "unknown" for r in failed)
        print(f"  Failed: {len(failed)}", file=sys.stderr)
        for reason, n in counts.most_common():
            print(f"    - {n}: {reason}", file=sys.stderr)

    def _print_summary(self, fetched: int, elapsed: float) -> None:
        _, rims_requests = self._rims_api.activity.snapshot()
        _, espn_requests = self._espn_api.activity.snapshot()
        _, site_web_requests = self._espn_site_web_api.activity.snapshot()
        total = rims_requests + espn_requests + site_web_requests
        print(
            f"[2/2] Done in {elapsed:.0f}s. "
            f"Wrote {len(self._dataset.games)} games "
            f"to {self._output_path}",
            file=sys.stderr,
        )
        print(
            f"      API requests: {total} "
            f"({rims_requests} RIMS, {espn_requests} ESPN core, "
            f"{site_web_requests} ESPN site, "
            f"{len(self._cache)} cache entries)",
            file=sys.stderr,
        )
