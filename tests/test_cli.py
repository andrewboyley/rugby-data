"""Tests for the Typer CLI migration of rugby_data.cli."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from typer.testing import CliRunner

from rugby_data.cli import app  # Assuming 'app' will be the Typer instance
from rugby_data.dataset import Dataset


class CliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.runner = CliRunner()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_path = Path(self.temp_dir.name)
        self.dataset_path = self.temp_path / "dataset.json"
        self.cache_path = self.temp_path / "api_cache.json"

        # Create a dummy dataset for testing
        self._create_dummy_dataset(self.dataset_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _create_dummy_dataset(self, path: Path, event_id="test-event") -> None:
        from rugby_data.models import Game

        dataset = Dataset(
            games=[
                Game(
                    event_id=event_id,
                    date="2026-01-01T12:00:00Z",
                    competitors=[],
                )
            ],
            teams={},
            players={},
            venues={},
            leagues={},
            coaches={},
        )
        dataset.save(path)

    def test_dataset_command_default(self) -> None:
        with patch("rugby_data.cli.build_dataset") as mock_build_dataset:
            result = self.runner.invoke(
                app,
                [
                    "dataset",
                    "--output",
                    str(self.dataset_path),
                    "--cache",
                    str(self.cache_path),
                ],
            )
            self.assertEqual(result.exit_code, 0)
            mock_build_dataset.assert_called_once_with(
                dataset_path=self.dataset_path,
                cache_path=self.cache_path,
                team_ids=None,
                source="rims-first",
                reset=False,
                skip_failed=False,
                refresh=False,
            )

    def test_dataset_command_with_team(self) -> None:
        with patch("rugby_data.cli.build_dataset") as mock_build_dataset:
            result = self.runner.invoke(
                app,
                [
                    "dataset",
                    "--team",
                    "1",
                    "--output",
                    str(self.dataset_path),
                    "--cache",
                    str(self.cache_path),
                ],
            )
            self.assertEqual(result.exit_code, 0)
            mock_build_dataset.assert_called_once_with(
                dataset_path=self.dataset_path,
                cache_path=self.cache_path,
                team_ids=["1"],
                source="rims-first",
                reset=False,
                skip_failed=False,
                refresh=False,
            )

    def test_dataset_command_with_reset_and_refresh_error(self) -> None:
        result = self.runner.invoke(
            app,
            [
                "dataset",
                "--reset",
                "--refresh",
                "--output",
                str(self.dataset_path),
                "--cache",
                str(self.cache_path),
            ],
        )
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn(
            "Error: --reset and --refresh cannot be used together", result.stdout
        )

        with patch("uvicorn.run") as mock_uvicorn_run:
            result = self.runner.invoke(
                app,
                [
                    "serve",
                    "--dataset",
                    str(self.dataset_path),
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "8000",
                ],
            )
            self.assertEqual(result.exit_code, 0)
            mock_uvicorn_run.assert_called_once()

    def test_serve_command_default_host_port(self) -> None:
        with patch("uvicorn.run") as mock_uvicorn_run:
            result = self.runner.invoke(
                app, ["serve", "--dataset", str(self.dataset_path)]
            )
            self.assertEqual(result.exit_code, 0)
            mock_uvicorn_run.assert_called_once_with(
                unittest.mock.ANY, host="127.0.0.1", port=8000, log_level="warning"
            )

    def test_help_command(self) -> None:
        result = self.runner.invoke(app, ["--help"])
        self.assertEqual(result.exit_code, 0)
        self.assertIn("Usage", result.stdout)
        self.assertIn("dataset", result.stdout)
        self.assertIn("serve", result.stdout)
