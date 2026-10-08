import json
import tempfile
import unittest
from pathlib import Path

from rugby_data.dataset import Dataset
from rugby_data.models import Competitor, Game, RosterEntry


class DatasetContractTests(unittest.TestCase):
    def test_save_writes_versioned_raw_dataset(self) -> None:
        dataset = Dataset(
            games=[
                Game(
                    event_id="event-001",
                    date="2026-01-01T12:00:00Z",
                    competitors=[
                        Competitor(1, True, 10, [RosterEntry("player-001", 1)]),
                        Competitor(2, False, 8, [RosterEntry("player-002", 1)]),
                    ],
                )
            ],
            teams={1: {"name": "One"}, 2: {"name": "Two"}},
            players={"player-001": "Player One", "player-002": "Player Two"},
        )

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "dataset.json"
            dataset.save(path)
            payload = json.loads(path.read_text())

        self.assertEqual(payload["schemaVersion"], 1)
        self.assertTrue(payload["generatedAt"].endswith("Z"))
        self.assertEqual(payload["games"][0]["eventId"], "event-001")
        self.assertEqual(
            payload["games"][0]["competitors"][0]["roster"][0]["playerId"],
            "player-001",
        )
        self.assertEqual(payload["teams"]["1"]["name"], "One")

    def test_load_accepts_unversioned_dataset(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "dataset.json"
            path.write_text(json.dumps({"games": [], "teams": {"1": "One"}}))
            dataset = Dataset.load(path)

        self.assertEqual(dataset.team_name(1), "One")

    def test_load_rejects_unknown_schema_version(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "dataset.json"
            path.write_text(json.dumps({"schemaVersion": 2, "games": []}))
            with self.assertRaisesRegex(
                ValueError, "unsupported dataset schema version"
            ):
                Dataset.load(path)


if __name__ == "__main__":
    unittest.main()
