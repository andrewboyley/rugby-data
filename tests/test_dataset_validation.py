import json
import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError

from rugby_data.dataset import Dataset
from rugby_data.models import (
    Competitor,
    Game,
    RosterEntry,
    competitor_from_dict,
    competitor_to_dict,
    game_from_dict,
    game_to_dict,
    roster_from_dict,
    roster_to_dict,
)


class DatasetValidationTests(unittest.TestCase):
    def test_models_accept_snake_case_and_dump_schema_v1_aliases(self) -> None:
        game = Game(
            event_id="event-1",
            date="2026-01-01T12:00:00Z",
            competitors=[
                Competitor(
                    team_id=1,
                    home=True,
                    score=10,
                    roster=[RosterEntry(player_id="player-1", jersey=1)],
                    coach_id="coach-1",
                ),
                Competitor(
                    team_id=2,
                    home=False,
                    score=8,
                    roster=[RosterEntry(player_id="player-2", jersey=2)],
                ),
            ],
            venue_id="venue-1",
            league_id="league-1",
        )

        self.assertEqual(
            game.model_dump(by_alias=True),
            {
                "eventId": "event-1",
                "date": "2026-01-01T12:00:00Z",
                "competitors": [
                    {
                        "teamId": 1,
                        "home": True,
                        "score": 10,
                        "roster": [{"playerId": "player-1", "jersey": 1}],
                        "coachId": "coach-1",
                    },
                    {
                        "teamId": 2,
                        "home": False,
                        "score": 8,
                        "roster": [{"playerId": "player-2", "jersey": 2}],
                        "coachId": None,
                    },
                ],
                "venueId": "venue-1",
                "leagueId": "league-1",
            },
        )

    def test_helper_apis_validate_camel_case_contract_and_preserve_ids(self) -> None:
        payload = {
            "eventId": "event-1",
            "date": None,
            "competitors": [
                {
                    "teamId": "1",
                    "home": True,
                    "score": 10,
                    "roster": [{"playerId": "player-1", "jersey": "1"}],
                    "coachId": "coach-1",
                },
                {
                    "teamId": 2,
                    "home": False,
                    "score": 8,
                    "roster": [{"playerId": "player-2", "jersey": None}],
                },
            ],
            "venueId": "venue-1",
            "leagueId": "league-1",
        }

        game = game_from_dict(payload)
        self.assertEqual(game.competitors[0].team_id, 1)
        self.assertEqual(game.competitors[0].roster[0].player_id, "player-1")
        self.assertEqual(
            game_to_dict(game),
            {
                **payload,
                "competitors": [
                    {
                        **payload["competitors"][0],
                        "teamId": 1,
                        "roster": [{"playerId": "player-1", "jersey": 1}],
                    },
                    {**payload["competitors"][1], "coachId": None},
                ],
            },
        )
        self.assertEqual(
            roster_to_dict(roster_from_dict({"playerId": "player-1", "jersey": "1"})),
            {"playerId": "player-1", "jersey": 1},
        )
        self.assertEqual(
            competitor_to_dict(competitor_from_dict(payload["competitors"][0])),
            {
                **payload["competitors"][0],
                "teamId": 1,
                "roster": [{"playerId": "player-1", "jersey": 1}],
            },
        )

    def test_model_validation_rejects_missing_required_contract_fields(self) -> None:
        with self.assertRaises(ValidationError):
            Game.model_validate({"date": None, "competitors": []})
        with self.assertRaises(ValidationError):
            Competitor.model_validate({"teamId": 1, "home": True, "roster": []})

    def test_dataset_load_does_not_filter_incomplete_artifacts(self) -> None:
        payload = {
            "schemaVersion": 1,
            "games": [
                {
                    "eventId": "incomplete",
                    "date": None,
                    "competitors": [],
                    "venueId": None,
                    "leagueId": None,
                }
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "dataset.json"
            path.write_text(json.dumps(payload))
            dataset = Dataset.load(path)

        self.assertEqual([game.event_id for game in dataset.games], ["incomplete"])


if __name__ == "__main__":
    unittest.main()
