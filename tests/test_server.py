import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from rugby_data.dataset import Dataset
from rugby_data.models import Competitor, Game, RosterEntry
from rugby_data.server import DatasetServer


class ServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "dataset.json"
        self._save("one")
        self.server = DatasetServer(("127.0.0.1", 0), self.path)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()
        self.directory.cleanup()

    def test_dataset_health_lookups_and_etag(self) -> None:
        payload, headers = self._get("/dataset")
        self.assertEqual(payload["games"][0]["eventId"], "one")
        self.assertEqual(headers["Content-Type"], "application/json; charset=utf-8")
        self.assertEqual(self._get("/health")[0]["schemaVersion"], 1)
        self.assertEqual(self._get("/games/one")[0]["eventId"], "one")
        self.assertEqual(self._get("/teams/1")[0]["name"], "One")
        self.assertEqual(self._get("/players/player-1")[0], "Player One")
        request = urllib.request.Request(
            f"{self.base_url}/dataset", headers={"If-None-Match": headers["ETag"]}
        )
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request)
        self.assertEqual(error.exception.code, 304)

    def test_reloads_valid_replacement_and_keeps_last_valid_snapshot(self) -> None:
        self._save("two")
        self.assertEqual(self._get("/games/two")[0]["eventId"], "two")
        self.path.write_text(json.dumps({"schemaVersion": 2}))
        self.assertEqual(self._get("/games/two")[0]["eventId"], "two")

    def test_unknown_path_and_method(self) -> None:
        for method, path, code in (("GET", "/missing", 404), ("POST", "/dataset", 405)):
            request = urllib.request.Request(f"{self.base_url}{path}", method=method)
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request)
            self.assertEqual(error.exception.code, code)

    def _save(self, event_id: str) -> None:
        Dataset(
            games=[
                Game(
                    event_id=event_id,
                    date=None,
                    competitors=[
                        Competitor(1, True, 1, [RosterEntry("player-1", 1)]),
                        Competitor(2, False, 0, [RosterEntry("player-2", 1)]),
                    ],
                )
            ],
            teams={1: {"name": "One"}},
            players={"player-1": "Player One"},
        ).save(self.path)

    def _get(self, path: str) -> tuple[object, object]:
        with urllib.request.urlopen(f"{self.base_url}{path}") as response:
            return json.load(response), response.headers


if __name__ == "__main__":
    unittest.main()
