"""Focused, offline coverage for ingestion audit remedies."""

import tempfile
import unittest
from pathlib import Path

from rugby_data.api import EspnApi
from rugby_data.builder import DatasetBuilder
from rugby_data.cache import ApiCache
from rugby_data.dataset import Dataset
from rugby_data.models import (
    Competitor,
    Game,
    RosterEntry,
    competitor_from_dict,
)
from rugby_data.rims_api import RimsApi


class AuditRemediesTests(unittest.TestCase):
    def test_cache_writes_at_the_soft_checkpoint(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cache.json"
            cache = ApiCache(path, soft_write_limit=2)

            cache.put("one", {"value": 1})
            self.assertFalse(path.exists())
            cache.put("two", {"value": 2})

            self.assertEqual(ApiCache(path).get("one"), {"value": 1})
            self.assertEqual(ApiCache(path).get("two"), {"value": 2})

    def test_roster_entries_without_ids_are_discarded_and_incomplete(self) -> None:
        competitor = competitor_from_dict(
            {
                "teamId": 1,
                "home": True,
                "score": 12,
                "roster": [{"playerId": None, "jersey": "1"}],
            }
        )
        self.assertEqual(competitor.roster, [])
        self.assertFalse(competitor.is_complete())

    def test_rims_roster_skips_player_without_id(self) -> None:
        builder = self._builder()
        roster = builder._fetch_rims_roster(
            {"teamList": {"list": [{"player": {}, "number": "1"}]}}
        )
        self.assertEqual(roster, [])

    def test_espn_player_id_is_not_merged_by_display_name(self) -> None:
        builder = self._builder()
        builder._dataset.register_player("rims-7", "Alex Smith")

        roster = builder._parse_site_web_roster(
            [{"athlete": {"id": "espn-9", "displayName": "Alex Smith"}, "jersey": "9"}]
        )

        self.assertEqual(roster[0].player_id, "espn-9")
        self.assertEqual(builder._dataset.player_name("espn-9"), "Alex Smith")

    def test_game_rejects_blank_roster_ids(self) -> None:
        game = Game(
            event_id="event",
            date=None,
            competitors=[
                Competitor(team_id=1, home=True, score=1, roster=[]),
                Competitor(
                    team_id=2,
                    home=False,
                    score=0,
                    roster=[RosterEntry(player_id="", jersey=1)],
                ),
            ],
        )
        self.assertFalse(game.is_complete())

    def _builder(self) -> DatasetBuilder:
        cache = ApiCache(Path(tempfile.gettempdir()) / "audit-remedies-cache.json")
        return DatasetBuilder(
            RimsApi(cache), EspnApi(cache), cache, Dataset(), Path("/tmp/dataset.json")
        )


if __name__ == "__main__":
    unittest.main()
