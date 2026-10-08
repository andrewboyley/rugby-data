"""Read-only HTTP server for the versioned dataset artifact."""

import hashlib
import json
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from .dataset import Dataset
from .models import game_to_dict


class DatasetSnapshot:
    def __init__(self, path: Path):
        self._path = path
        self._lock = threading.Lock()
        self._stat_key: tuple[int, int] | None = None
        self._payload: dict = {}
        self._dataset = Dataset()
        self.reload()

    def reload_if_changed(self) -> None:
        try:
            stat = self._path.stat()
            if (stat.st_mtime_ns, stat.st_size) != self._stat_key:
                self.reload()
        except (FileNotFoundError, ValueError, json.JSONDecodeError):
            pass

    def reload(self) -> None:
        stat = self._path.stat()
        raw = json.loads(self._path.read_text())
        dataset = Dataset.load(self._path)
        if not isinstance(raw, dict):
            raise ValueError("dataset must be a JSON object")
        with self._lock:
            self._stat_key = (stat.st_mtime_ns, stat.st_size)
            self._payload = raw
            self._dataset = dataset

    def response(self, path: str) -> tuple[dict | str, str]:
        self.reload_if_changed()
        with self._lock:
            payload = self._payload
            dataset = self._dataset
            etag = hashlib.sha256(repr(self._stat_key).encode()).hexdigest()
            if path == "/dataset":
                return payload, etag
            if path == "/health":
                return (
                    {
                        "status": "ok",
                        "schemaVersion": payload["schemaVersion"],
                        "generatedAt": payload["generatedAt"],
                    },
                    etag,
                )
            kind, _, value = path[1:].partition("/")
            if not value or "/" in value:
                raise KeyError(path)
            value = unquote(value)
            if kind == "games":
                result = next(
                    (g for g in dataset.games if g.event_id == value),
                    None,
                )
                if result is not None:
                    result = game_to_dict(result)
            elif kind == "teams":
                result = dataset.teams.get(int(value)) if value.isdigit() else None
            elif kind == "players":
                result = dataset.players.get(value)
            elif kind == "venues":
                result = dataset.venues.get(value)
            elif kind == "leagues":
                result = dataset.leagues.get(value)
            elif kind == "coaches":
                result = dataset.coaches.get(value)
            else:
                raise KeyError(path)
            if result is None:
                raise KeyError(path)
            return result, etag


class DatasetServer(ThreadingHTTPServer):
    def __init__(self, address: tuple[str, int], dataset_path: Path):
        self.snapshot = DatasetSnapshot(dataset_path)
        super().__init__(address, DatasetHandler)


class DatasetHandler(BaseHTTPRequestHandler):
    server: DatasetServer

    def do_GET(self) -> None:
        try:
            payload, etag = self.server.snapshot.response(urlsplit(self.path).path)
        except KeyError:
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        except (FileNotFoundError, ValueError, json.JSONDecodeError) as error:
            self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
            return
        if self.headers.get("If-None-Match") == etag:
            self.send_response(HTTPStatus.NOT_MODIFIED)
            self.send_header("ETag", etag)
            self.end_headers()
            return
        self._json(HTTPStatus.OK, payload, etag)

    def do_POST(self) -> None:
        self._method_not_allowed()

    def do_PUT(self) -> None:
        self._method_not_allowed()

    def do_DELETE(self) -> None:
        self._method_not_allowed()

    def _method_not_allowed(self) -> None:
        self.send_response(HTTPStatus.METHOD_NOT_ALLOWED)
        self.send_header("Allow", "GET")
        self.end_headers()

    def _json(
        self, status: HTTPStatus, payload: dict | str, etag: str | None = None
    ) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        if etag:
            self.send_header("ETag", etag)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        pass
