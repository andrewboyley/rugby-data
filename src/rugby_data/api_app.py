"""FastAPI application for serving the versioned rugby dataset."""

import hashlib
import json
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from .dataset import Dataset
from .models import game_to_dict


class DatasetSnapshot:
    """Thread-safe cached snapshot of the dataset artifact with hot-reload."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._stat_key: tuple[int, int] | None = None
        self._payload: dict = {}
        self._dataset = Dataset()
        self._games_by_id: dict[str, dict] = {}
        self.reload()

    def reload_if_changed(self) -> None:
        try:
            stat = self._path.stat()
            if (stat.st_mtime_ns, stat.st_size) != self._stat_key:
                self.reload()
        except (FileNotFoundError, ValueError, json.JSONDecodeError):
            # Artifact is missing or mid-write; keep serving the last snapshot.
            return

    def reload(self) -> None:
        stat = self._path.stat()
        raw = json.loads(self._path.read_text())
        if not isinstance(raw, dict):
            raise ValueError("dataset must be a JSON object")
        dataset = Dataset.load(self._path)
        games_by_id = {g.event_id: game_to_dict(g) for g in dataset.games}
        with self._lock:
            self._stat_key = (stat.st_mtime_ns, stat.st_size)
            self._payload = raw
            self._dataset = dataset
            self._games_by_id = games_by_id

    @property
    def etag(self) -> str:
        with self._lock:
            return hashlib.sha256(repr(self._stat_key).encode()).hexdigest()

    @property
    def payload(self) -> dict:
        return self._payload

    @property
    def dataset(self) -> Dataset:
        return self._dataset

    @property
    def games_by_id(self) -> dict[str, dict]:
        return self._games_by_id


def create_app(dataset_path: Path) -> FastAPI:
    """Factory creating a FastAPI app serving the dataset artifact."""
    try:
        snapshot = DatasetSnapshot(dataset_path)
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as error:
        raise RuntimeError(f"cannot load dataset artifact: {dataset_path}") from error

    app = FastAPI(title="Rugby Data API", docs_url=None, redoc_url=None)

    def get_snapshot() -> DatasetSnapshot:
        snapshot.reload_if_changed()
        return snapshot

    @app.middleware("http")
    async def etag_middleware(request: Request, call_next):
        if_none_match = request.headers.get("if-none-match")
        current_etag = snapshot.etag
        if request.method == "GET" and if_none_match and if_none_match == current_etag:
            return Response(status_code=304, headers={"etag": current_etag})
        response = await call_next(request)
        if request.method == "GET" and response.status_code == 200:
            response.headers["etag"] = current_etag
        return response

    @app.get("/dataset")
    def get_dataset():
        snap = get_snapshot()
        return JSONResponse(snap.payload)

    @app.get("/health")
    def get_health():
        snap = get_snapshot()
        return {
            "status": "ok",
            "schemaVersion": snap.payload.get("schemaVersion", 1),
            "generatedAt": snap.payload.get("generatedAt"),
        }

    @app.get("/games/{event_id}")
    def get_game(event_id: str):
        snap = get_snapshot()
        game = snap.games_by_id.get(event_id)
        if game is None:
            raise HTTPException(status_code=404, detail="game not found")
        return game

    @app.get("/teams/{team_id}")
    def get_team(team_id: int):
        snap = get_snapshot()
        team = snap.dataset.teams.get(team_id)
        if team is None:
            raise HTTPException(status_code=404, detail="team not found")
        return team

    @app.get("/players/{player_id}")
    def get_player(player_id: str):
        snap = get_snapshot()
        player = snap.dataset.players.get(player_id)
        if player is None:
            raise HTTPException(status_code=404, detail="player not found")
        return player

    @app.get("/venues/{venue_id}")
    def get_venue(venue_id: str):
        snap = get_snapshot()
        venue = snap.dataset.venues.get(venue_id)
        if venue is None:
            raise HTTPException(status_code=404, detail="venue not found")
        return venue

    @app.get("/leagues/{league_id}")
    def get_league(league_id: str):
        snap = get_snapshot()
        league = snap.dataset.leagues.get(league_id)
        if league is None:
            raise HTTPException(status_code=404, detail="league not found")
        return league

    @app.get("/coaches/{coach_id}")
    def get_coach(coach_id: str):
        snap = get_snapshot()
        coach = snap.dataset.coaches.get(coach_id)
        if coach is None:
            raise HTTPException(status_code=404, detail="coach not found")
        return coach

    return app
