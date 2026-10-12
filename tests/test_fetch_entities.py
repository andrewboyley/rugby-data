"""Offline tests for venue, league, coach, and player extraction.

These exercise the RIMS and ESPN summary parsing with synthetic payloads, so
they never touch the network or the on-disk API cache, and they run as part of
the normal pytest suite.
"""

import tempfile
import unittest
from pathlib import Path

from rugby_data.api import EspnApi
from rugby_data.builder import DatasetBuilder
from rugby_data.cache import ApiCache
from rugby_data.config import HOME_KIT_COLOURS, RIMS_TEAM_IDS
from rugby_data.dataset import Dataset
from rugby_data.models import game_from_dict, game_to_dict
from rugby_data.rims_api import RimsApi

RIMS_SUMMARY = {
    "match": {
        "matchId": "RIMS123",
        "time": {"label": "2024-07-06T15:00:00Z"},
        "competition": "The Rugby Championship",
        "venue": {
            "id": "1234",
            "name": "Loftus Versfeld",
            "city": "Pretoria",
            "country": "South Africa",
        },
        "teams": [{"id": "39"}, {"id": "40"}],
        "scores": [27, 25],
    },
    "teams": [
        {
            "teamList": {
                "list": [
                    {
                        "number": "9",
                        "player": {
                            "id": "p1",
                            "displayName": "Player One",
                            "name": {"display": "Player One"},
                        },
                    },
                    {
                        "positionLabel": "Head Coach",
                        "player": {"id": "c1", "name": {"display": "Coach One"}},
                    },
                ]
            },
            "naming": [{"abbr": "RSA"}],
        },
        {
            "teamList": {
                "list": [
                    {
                        "number": "1",
                        "player": {
                            "id": "p2",
                            "displayName": "Player Two",
                            "name": {"display": "Player Two"},
                        },
                    }
                ]
            },
            "naming": [{"abbr": "NZL"}],
        },
    ],
}

ESPN_SUMMARY = {
    "header": {
        "league": {"id": "1704", "name": "Test League", "abbreviation": "TL"},
        "competitions": [
            {
                "date": "2024-07-06T15:00:00Z",
                "competitors": [
                    {"id": "5", "score": "27"},
                    {"id": "999999", "score": "25"},
                ],
            }
        ],
    },
    "gameInfo": {
        "venue": {
            "id": "v99",
            "fullName": "Test Park",
            "address": {"city": "Leeds", "country": "England"},
        }
    },
    "rosters": [
        {
            "team": {"id": "5", "displayName": "South Africa", "abbreviation": "RSA"},
            "homeAway": "home",
            "roster": [
                {
                    "athlete": {"id": "e1", "displayName": "ESPN Player"},
                    "jersey": "9",
                }
            ],
        },
        {
            "team": {"id": "999999", "displayName": "Unknown XV"},
            "homeAway": "away",
            "roster": [],
        },
    ],
}


class FetchEntitiesTests(unittest.TestCase):
    def setUp(self) -> None:
        cache = ApiCache(Path(tempfile.mkdtemp()) / "cache.json")
        self.builder = DatasetBuilder(
            RimsApi(cache),
            EspnApi(cache),
            cache,
            Dataset(),
            Path("/tmp/test_fetch_out.json"),
            source="rims",
        )
        self.dataset = self.builder._dataset

    # ---- RIMS ----

    def test_rims_game_registers_venue_league_and_scores(self) -> None:
        game = self.builder._game_from_rims(RIMS_SUMMARY)

        self.assertEqual(game.venue_id, "1234")
        self.assertTrue(game.venue_id.isdigit())
        self.assertEqual(game.league_id, "The Rugby Championship")
        self.assertEqual([c.score for c in game.competitors], [27, 25])
        self.assertEqual(self.dataset.venues["1234"]["city"], "Pretoria")
        self.assertEqual(
            self.dataset.leagues["The Rugby Championship"]["name"],
            "The Rugby Championship",
        )

    def test_rims_roster_excludes_coach_and_registers_players(self) -> None:
        game = self.builder._game_from_rims(RIMS_SUMMARY)

        first = game.competitors[0]
        self.assertTrue(first.home)
        self.assertEqual([entry.player_id for entry in first.roster], ["p1"])
        self.assertEqual(self.dataset.players["p1"], "Player One")
        self.assertNotIn("c1", self.dataset.players)

    def test_rims_coach_is_registered_per_competitor(self) -> None:
        game = self.builder._game_from_rims(RIMS_SUMMARY)

        self.assertEqual(game.competitors[0].coach_id, "c1")
        self.assertIsNone(game.competitors[1].coach_id)
        self.assertEqual(self.dataset.coaches["c1"], "Coach One")

    def test_rims_team_colours_use_reverse_espn_mapping(self) -> None:
        self.builder._game_from_rims(RIMS_SUMMARY)

        # RIMS team 39 reverse-maps to ESPN 5, whose curated kit colour wins.
        self.assertEqual(self.dataset.teams[39]["color"], HOME_KIT_COLOURS["5"])
        self.assertEqual(self.dataset.teams[39]["abbreviation"], "RSA")

    def test_entity_keys_are_prefix_free(self) -> None:
        self.builder._game_from_rims(RIMS_SUMMARY)

        prefixed = ("rims:", "espn:")
        self.assertFalse(any(k.startswith(prefixed) for k in self.dataset.venues))
        self.assertFalse(any(k.startswith(prefixed) for k in self.dataset.leagues))

    # ---- ESPN site web ----

    def test_site_web_registers_venue_and_league(self) -> None:
        self.assertEqual(
            self.builder._register_venue_from_site_web(ESPN_SUMMARY), "v99"
        )
        self.assertEqual(
            self.builder._register_league_from_site_web(ESPN_SUMMARY), "1704"
        )

        venue = self.dataset.venues["v99"]
        self.assertEqual(venue["city"], "Leeds")
        self.assertEqual(venue["country"], "England")
        self.assertEqual(self.dataset.leagues["1704"]["name"], "Test League")

    def test_site_web_team_registration_normalises_colour(self) -> None:
        self.builder._register_team_from_site_web(
            39, {"displayName": "South Africa"}, 5
        )

        self.assertEqual(self.dataset.teams[39]["name"], "South Africa")
        self.assertEqual(self.dataset.teams[39]["color"], HOME_KIT_COLOURS["5"])

    def test_site_web_game_canonicalises_team_ids_and_scores(self) -> None:
        summary = dict(ESPN_SUMMARY)
        self.builder._espn_site_web_api.get_summary = (  # type: ignore[method-assign]
            lambda _league, _event: summary
        )
        game = self.builder._fetch_game_espn_site_web(
            "https://sports.core.api.espn.com/v2/leagues/1704/events/999"
        )

        self.assertIsNotNone(game)
        self.assertEqual(game.event_id, "999")
        team_ids = [c.team_id for c in game.competitors]
        self.assertEqual(team_ids, [int(RIMS_TEAM_IDS["5"]), 999999])
        self.assertEqual([c.score for c in game.competitors], [27, 25])

    def test_espn_team_id_falls_back_to_itself_when_unknown(self) -> None:
        self.assertEqual(self.builder._to_rims_team_id(5), int(RIMS_TEAM_IDS["5"]))
        self.assertEqual(self.builder._to_rims_team_id(999999), 999999)

    # ---- model round-trip ----

    def test_game_round_trip_preserves_entity_ids(self) -> None:
        game = self.builder._game_from_rims(RIMS_SUMMARY)
        restored = game_from_dict(game_to_dict(game))

        self.assertEqual(restored.venue_id, game.venue_id)
        self.assertEqual(restored.league_id, game.league_id)
        self.assertEqual(restored.competitors[0].coach_id, game.competitors[0].coach_id)


if __name__ == "__main__":
    unittest.main()
