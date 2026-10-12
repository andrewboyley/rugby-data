"""Negative-cache bookkeeping for dataset builds."""

from __future__ import annotations

from .builder_base import BuilderBase
from .config import NEG_FAIL_PREFIX


class NegativeCacheMixin(BuilderBase):
    """Names and persists deterministic build failures."""

    _NEG_MATCH_PREFIX = "negative://espn-fallback/match/"
    _NEG_LINEUP_PREFIX = "negative://espn-fallback/lineup/"

    def _neg_match_key(self, match_id: str) -> str:
        return f"{self._NEG_MATCH_PREFIX}{match_id}"

    def _neg_lineup_key(self, event_id: str) -> str:
        return f"{self._NEG_LINEUP_PREFIX}{event_id}"

    def _is_neg_match(self, match_id: str) -> bool:
        return self._cache.get(self._neg_match_key(match_id)) is not None

    def _is_neg_lineup(self, event_id: str) -> bool:
        return self._cache.get(self._neg_lineup_key(event_id)) is not None

    def _record_neg_match(self, match_id: str, reason: str) -> None:
        self._cache.put(self._neg_match_key(match_id), {"reason": reason})

    def _record_neg_lineup(self, event_id: str, reason: str) -> None:
        self._cache.put(self._neg_lineup_key(event_id), {"reason": reason})

    def _neg_fail_key(self, event_id: str) -> str:
        return f"{NEG_FAIL_PREFIX}{event_id}"

    def _is_terminal_fail(self, event_id: str) -> bool:
        return self._cache.get(self._neg_fail_key(event_id)) is not None

    def _record_terminal_fail(self, event_id: str, reason: str) -> None:
        self._cache.put(self._neg_fail_key(event_id), {"reason": reason})
