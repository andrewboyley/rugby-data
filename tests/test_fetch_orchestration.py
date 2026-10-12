"""Regression tests for fetch orchestration, fallback search, and registration.

These lock in the behavior-preserving refactor that split ``DatasetBuilder``
into focused mixins, exercising branches the existing suite did not cover.
"""

import tempfile
import unittest
from pathlib import Path

from rugby_data.api import EspnApi
from rugby_data.builder import DatasetBuilder
from rugby_data.cache import ApiCache
from rugby_data.dataset import Dataset
from rugby_data.models import Competitor, Game, RosterEntry
from rugby_data.rims_api import RimsApi

EVENT_URL = "https://sports.core.api.espn.com/v2/leagues/1/events/123"


def _complete_game(event_id: str = "123") -> Game:
    roster = [RosterEntry(player_id="p1", jersey=1)]
    return Game(
        event_id=event_id,
        date="2020-03-14",
        competitors=[
            Competitor(team_id=1, home=True, score=10, roster=roster),
            Competitor(team_id=2, home=False, score=7, roster=roster),
        ],
    )


def _incomplete_game(event_id: str = "123") -> Game:
    return Game(
        event_id=event_id,
        date="2020-03-14",
        competitors=[
            Competitor(team_id=1, home=True, score=10, roster=[]),
            Competitor(team_id=2, home=False, score=7, roster=[]),
        ],
    )


class FetchOrchestrationTests(unittest.TestCase):
    def _builder(self) -> DatasetBuilder:
        cache = ApiCache(Path(tempfile.mkdtemp()) / "cache.json")
        return DatasetBuilder(
            RimsApi(cache), EspnApi(cache), cache, Dataset(), Path("/tmp/dataset.json")
        )

    # ---- _get_espn_fallback_url ----

    def test_fallback_url_returns_cached_mapping(self) -> None:
        builder = self._builder()
        builder._espn_fallback_map["m1"] = "https://example/event/1"
        self.assertEqual(
            builder._get_espn_fallback_url("m1"), "https://example/event/1"
        )

    def test_fallback_url_finds_matching_event_and_caches_it(self) -> None:
        builder = self._builder()
        builder._years = [2019, 2020, 2021]
        builder._RIMS_TO_ESPN = {"7": "5", "8": "6"}
        builder._rims_match_data["m1"] = ("2020-03-14", ["7", "8"])
        url = "https://sports.core.api.espn.com/v2/leagues/1/events/99"
        builder._espn_api.events_for_year = (  # type: ignore[method-assign]
            lambda team_id, year: [url] if team_id == "5" and year == 2020 else []
        )
        builder._espn_api.get = lambda _url: {  # type: ignore[method-assign]
            "date": "2020-03-14T15:00:00Z",
            "competitions": [{"competitors": [{"id": "5"}, {"id": "6"}]}],
        }

        self.assertEqual(builder._get_espn_fallback_url("m1"), url)
        self.assertEqual(builder._espn_fallback_map["m1"], url)

    def test_fallback_url_records_negative_when_no_event_matches(self) -> None:
        builder = self._builder()
        builder._years = [2020]
        builder._RIMS_TO_ESPN = {"7": "5", "8": "6"}
        builder._rims_match_data["m1"] = ("2020-03-14", ["7", "8"])
        builder._espn_api.events_for_year = (  # type: ignore[method-assign]
            lambda team_id, year: []
        )

        self.assertIsNone(builder._get_espn_fallback_url("m1"))
        self.assertTrue(builder._is_neg_match("m1"))

    def test_fallback_url_ignores_unparseable_date(self) -> None:
        builder = self._builder()
        builder._rims_match_data["m1"] = ("not-a-date", ["7"])
        self.assertIsNone(builder._get_espn_fallback_url("m1"))

    # ---- _fetch_game dispatch ----

    def test_fetch_game_espn_source_marks_source_espn(self) -> None:
        builder = self._builder()
        builder._source = "espn"
        builder._fetch_game_espn_site_web = (  # type: ignore[method-assign]
            lambda _url: _complete_game()
        )
        result = builder._fetch_game(EVENT_URL)
        self.assertEqual(result.source, "espn")
        self.assertIsNotNone(result.game)
        self.assertEqual(result.match_id, "123")

    def test_fetch_game_rims_source_complete(self) -> None:
        builder = self._builder()
        builder._source = "rims"
        builder._fetch_rims = lambda _mid: {"match": {}}  # type: ignore[method-assign]
        builder._game_from_rims = lambda _s: _complete_game()  # type: ignore[method-assign]
        result = builder._fetch_game(EVENT_URL)
        self.assertEqual(result.source, "rims")
        self.assertIsNotNone(result.game)

    def test_fetch_game_rims_source_incomplete_records_terminal_fail(self) -> None:
        builder = self._builder()
        builder._source = "rims"
        builder._fetch_rims = lambda _mid: {}  # type: ignore[method-assign]
        builder._game_from_rims = lambda _s: _incomplete_game()  # type: ignore[method-assign]
        result = builder._fetch_game(EVENT_URL)
        self.assertEqual(result.source, "rims")
        self.assertIsNone(result.game)
        self.assertIsNotNone(result.partial)
        self.assertTrue(builder._is_terminal_fail("123"))

    # ---- _fetch_game rims-first fallback ----

    def test_rims_first_falls_back_to_espn_when_rims_incomplete(self) -> None:
        builder = self._builder()
        builder._source = "rims-first"
        builder._fetch_rims = lambda _mid: {}  # type: ignore[method-assign]
        builder._game_from_rims = lambda _s: _incomplete_game()  # type: ignore[method-assign]
        builder._get_espn_fallback_url = (  # type: ignore[method-assign]
            lambda _mid: "https://example/event/1"
        )
        builder._fetch_game_espn_site_web = (  # type: ignore[method-assign]
            lambda _url: _complete_game()
        )
        result = builder._fetch_game(EVENT_URL)
        self.assertEqual(result.source, "rims→espn")
        self.assertTrue(result.fell_back)
        self.assertIsNotNone(result.game)

    def test_rims_first_no_espn_match_records_terminal_fail(self) -> None:
        builder = self._builder()
        builder._source = "rims-first"
        builder._fetch_rims = lambda _mid: {}  # type: ignore[method-assign]
        builder._game_from_rims = lambda _s: _incomplete_game()  # type: ignore[method-assign]
        builder._get_espn_fallback_url = (  # type: ignore[method-assign]
            lambda _mid: None
        )
        result = builder._fetch_game(EVENT_URL)
        self.assertEqual(result.source, "rims→espn")
        self.assertTrue(result.fell_back)
        self.assertIsNone(result.game)
        self.assertTrue(builder._is_terminal_fail("123"))

    # ---- registration ----

    def test_register_team_from_rims_normalises_meta_colour(self) -> None:
        builder = self._builder()
        builder._register_team_from_rims(
            999999, {"colour": "abcdef"}, {"name": "Test XV"}
        )
        team = builder._dataset.teams[999999]
        self.assertEqual(team["name"], "Test XV")
        self.assertEqual(team["color"], "#abcdef")

    def test_register_venue_from_site_web_reads_nested_address(self) -> None:
        builder = self._builder()
        summary = {
            "gameInfo": {
                "venue": {
                    "id": "v1",
                    "fullName": "Test Park",
                    "address": {"city": "Leeds", "country": "England"},
                }
            }
        }
        self.assertEqual(builder._register_venue_from_site_web(summary), "v1")
        self.assertEqual(builder._dataset.venues["v1"]["city"], "Leeds")
        self.assertEqual(builder._dataset.venues["v1"]["country"], "England")


if __name__ == "__main__":
    unittest.main()
