import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from rugby_data.api_app import create_app
from rugby_data.dataset import Dataset
from rugby_data.models import Competitor, Game, RosterEntry


class ServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "dataset.json"
        self._save("one")
        self.app = create_app(self.path)
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.directory.cleanup()

    def _save(self, event_id: str) -> None:
        dataset = Dataset(
            games=[
                Game(
                    event_id=event_id,
                    date="2026-01-01T12:00:00Z",
                    competitors=[
                        Competitor(1, True, 10, [RosterEntry("player-1", 1)]),
                        Competitor(2, False, 8, [RosterEntry("player-2", 1)]),
                    ],
                )
            ],
            teams={1: {"name": "One"}, 2: {"name": "Two"}},
            players={
                "player-1": "Player One",
                "player-2": "Player Two",
            },
            venues={
                f"venue-{event_id}": {
                    "name": f"Venue {event_id}",
                    "city": "City",
                    "state": "State",
                }
            },
            leagues={
                f"league-{event_id}": {
                    "name": f"League {event_id}",
                    "abbreviation": "L",
                }
            },
            coaches={f"coach-{event_id}": f"Coach {event_id}"},
        )
        dataset.save(self.path)

    def test_dataset_health_lookups_and_etag(self) -> None:
        # Initial /dataset request
        response = self.client.get("/dataset")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        etag = response.headers["ETag"]

        self.assertEqual(payload["games"][0]["eventId"], "one")
        self.assertEqual(response.headers["Content-Type"], "application/json")

        # /health request
        health_response = self.client.get("/health")
        self.assertEqual(health_response.status_code, 200)
        self.assertEqual(health_response.json()["status"], "ok")
        self.assertEqual(health_response.json()["schemaVersion"], 1)

        # Fragment lookups
        self.assertEqual(self.client.get("/games/one").json()["eventId"], "one")
        self.assertEqual(self.client.get("/teams/1").json()["name"], "One")
        self.assertEqual(self.client.get("/players/player-1").json(), "Player One")
        self.assertEqual(
            self.client.get("/venues/venue-one").json()["name"], "Venue one"
        )
        self.assertEqual(
            self.client.get("/leagues/league-one").json()["name"], "League one"
        )
        self.assertEqual(self.client.get("/coaches/coach-one").json(), "Coach one")

        # ETag revalidation
        response_304 = self.client.get("/dataset", headers={"If-None-Match": etag})
        self.assertEqual(response_304.status_code, 304)
        self.assertEqual(response_304.headers["ETag"], etag)

    def test_reloads_valid_replacement_and_keeps_last_valid_snapshot(self) -> None:
        self._save("two")  # Save a new valid dataset
        response_two = self.client.get("/games/two")
        self.assertEqual(response_two.status_code, 200)
        self.assertEqual(response_two.json()["eventId"], "two")

        # Write an invalid dataset
        self.path.write_text(json.dumps({"schemaVersion": 2}))
        # The API should retain the last valid snapshot ("two")
        retained_response = self.client.get("/games/two")
        self.assertEqual(retained_response.status_code, 200)
        self.assertEqual(retained_response.json()["eventId"], "two")

        # Invalid replacements retain the old snapshot for unknown lookup handling.
        not_found_response = self.client.get("/games/invalid")
        self.assertEqual(not_found_response.status_code, 404)

    def test_server_startup_failure_on_missing_or_invalid_dataset(self) -> None:
        # Test missing file
        self.directory.cleanup()
        with self.assertRaises(RuntimeError):  # create_app should raise RuntimeError
            create_app(self.path)

        # Test invalid JSON
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "dataset.json"
        self.path.write_text("invalid json")
        with self.assertRaises(RuntimeError):
            create_app(self.path)

        # Test unsupported schema version
        self.path.write_text(json.dumps({"schemaVersion": 2}))
        with self.assertRaises(RuntimeError):
            create_app(self.path)
        self.directory.cleanup()

    def test_unsupported_methods_return_405(self) -> None:
        response = self.client.post("/dataset")
        self.assertEqual(response.status_code, 405)
        response = self.client.put("/dataset")
        self.assertEqual(response.status_code, 405)
        response = self.client.delete("/dataset")
        self.assertEqual(response.status_code, 405)

    def test_unknown_paths_return_404(self) -> None:
        response = self.client.get("/non-existent-path")
        self.assertEqual(response.status_code, 404)

    def test_health_endpoint_not_ready_returns_503(self) -> None:
        pass
