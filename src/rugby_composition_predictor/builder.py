"""Orchestrates fetching a rugby dataset from the ESPN CORE API."""

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .api import EspnApi, event_id_from_url
from .cache import ApiCache
from .config import (
    DEFAULT_MAX_WORKERS,
    DEFAULT_SAVE_EVERY,
    INTERNATIONAL_TEAM_IDS,
    YEARS,
)
from .dataset import Dataset
from .models import Competitor, Game, RosterEntry
from .reporting import BuildListener


class DatasetBuilder:
    def __init__(
        self,
        api: EspnApi,
        cache: ApiCache,
        dataset: Dataset,
        output_path: Path,
        *,
        team_ids: list[str] | None = None,
        years=YEARS,
        max_workers: int = DEFAULT_MAX_WORKERS,
        save_every: int = DEFAULT_SAVE_EVERY,
    ):
        self._api = api
        self._cache = cache
        self._dataset = dataset
        self._output_path = output_path
        self._team_ids = team_ids if team_ids is not None else INTERNATIONAL_TEAM_IDS
        self._years = years
        self._max_workers = max_workers
        self._save_every = save_every
        self._requests = 0

    def build(self, listener: BuildListener | None = None) -> None:
        """Fetch all pending events and save the completed dataset."""
        # Load existing games from dataset to sync with cache's processed events
        for game in self._dataset.games:
            self._cache.mark_processed(game.event_id)

        event_urls = self._discover_event_urls()
        pending = [
            u for u in event_urls if not self._cache.is_processed(event_id_from_url(u))
        ]

        print(f"[1/2] Found {len(event_urls)} events, {len(pending)} to fetch\n")

        if listener:
            listener.task_started(len(pending))

        t0 = time.time()
        with ThreadPoolExecutor(max_workers=self._max_workers) as pool:
            futures = {pool.submit(self._fetch_game, u): u for u in pending}
            for i, future in enumerate(as_completed(futures), 1):
                game = future.result()
                if game is not None and game.is_complete():
                    self._cache.mark_processed(game.event_id)
                    self._dataset.merge([game])
                self._report(listener, i, game)
                if i % self._save_every == 0 or i == len(pending):
                    self._dataset.save(self._output_path)
                    self._cache.save(force=True)

        self._dataset.save(self._output_path)
        self._cache.save(force=True)
        if listener:
            listener.task_finished()

        elapsed = time.time() - t0
        self._print_summary(len(pending), elapsed)

    # ---- private helpers ----

    def _discover_event_urls(self) -> list[str]:
        urls = set()
        for team_id in self._team_ids:
            for year in self._years:
                urls.update(self._api.events_for_year(team_id, year))
        return sorted(urls)

    def _fetch_game(self, event_url: str) -> Game | None:
        event = self._api.get(event_url)
        competitions = event.get("competitions", [])
        if not competitions:
            return None
        competition = self._api.get(competitions[0]["$ref"])
        return self._game_from_competition(event, competition)

    def _game_from_competition(self, event: dict, competition: dict) -> Game:
        competitors = []
        for competitor in competition.get("competitors", []):
            team_id = int(competitor["id"])
            self._register_team(team_id, competitor["team"]["$ref"])
            competitors.append(
                Competitor(
                    team_id=team_id,
                    home=competitor.get("homeAway") == "home",
                    score=self._fetch_score(competitor),
                    roster=self._fetch_roster(competitor),
                )
            )
        return Game(
            event_id=int(event["id"]),
            date=event.get("date"),
            competitors=competitors,
        )

    def _register_team(self, team_id: int, team_ref: str) -> None:
        if self._dataset.team_name(team_id):
            return
        team = self._api.get(team_ref)
        name = (
            team.get("displayName")
            or team.get("name")
            or team.get("slug")
            or str(team_id)
        )
        color = team.get("color") or team.get("alternateColor")
        if color and isinstance(color, str):
            color = "#" + color.lstrip("#")
        else:
            color = None
        self._dataset.register_team(team_id, name, color)

    def _fetch_score(self, competitor: dict) -> int | None:
        score_ref = competitor.get("score", {}).get("$ref")
        if not score_ref:
            return None
        display = self._api.get(score_ref).get("displayValue")
        try:
            return int(display)
        except (TypeError, ValueError):
            return None

    def _fetch_roster(self, competitor: dict) -> list[RosterEntry]:
        roster_ref = competitor.get("roster", {}).get("$ref")
        if not roster_ref:
            return []
        entries = self._api.get(roster_ref).get("entries", [])
        roster = []
        for entry in entries:
            player_id = int(entry["playerId"])
            self._register_player(player_id, entry["athlete"]["$ref"])
            roster.append(
                RosterEntry(
                    player_id=player_id,
                    jersey=self._parse_jersey(entry["jersey"]),
                )
            )
        return roster

    def _parse_jersey(self, value) -> int:
        return int(value) if str(value).isdigit() else value

    def _register_player(self, player_id: int, athlete_ref: str) -> None:
        if self._dataset.player_name(player_id):
            return
        athlete = self._api.get(athlete_ref)
        name = athlete.get("displayName") or athlete.get("fullName") or str(player_id)
        self._dataset.register_player(player_id, name)

    def _report(self, listener, index: int, game: Game | None) -> None:
        if not listener or game is None:
            return
        action, _ = self._api.activity.snapshot()
        label = f"{game.date[:10]} " + " vs ".join(
            self._dataset.team_name(c.team_id) or f"team{c.team_id}"
            for c in game.competitors
        )
        listener.event_fetched(index, label, action, game.is_complete())

    def _print_summary(self, fetched: int, elapsed: float) -> None:
        _, requests = self._api.activity.snapshot()
        print(
            f"[2/2] Done in {elapsed:.0f}s. "
            f"Wrote {len(self._dataset.games)} games "
            f"to {self._output_path}"
        )
        print(f"      API requests: {requests} ({len(self._cache)} cache entries)")
