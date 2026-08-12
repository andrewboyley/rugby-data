"""Thread-safe, atomic, persistent JSON-backed API cache.

Stores raw API responses keyed by URL plus the set of event ids that have
already been processed (so a run can resume where it left off).
"""

import json
import os
import sys
import threading
from pathlib import Path
from typing import Any

from .config import CACHE_PROCESSED_KEY, CACHE_SOFT_WRITE_LIMIT


class ApiCache:
    def __init__(self, path: Path, soft_write_limit: int = CACHE_SOFT_WRITE_LIMIT):
        self._path = path
        self._soft_write_limit = soft_write_limit
        self._lock = threading.Lock()
        self._writes = 0
        self._entries, self._processed = self._load()

    # ---- loading ----

    def _load(self) -> tuple[dict, set[int]]:
        try:
            with open(self._path) as f:
                data = json.load(f)
        except FileNotFoundError:
            return {}, set()
        except json.JSONDecodeError as e:
            self._recover_corrupt(e)
            return {}, set()
        processed = data.pop(CACHE_PROCESSED_KEY, [])
        return data, {int(e) for e in processed}

    def _recover_corrupt(self, error: json.JSONDecodeError) -> None:
        backup = self._path.with_suffix(self._path.suffix + ".corrupt")
        os.replace(self._path, backup)
        print(
            f"[!] {self._path} corrupt ({error}); "
            f"backed up to {backup}, starting fresh",
            file=sys.stderr,
        )

    # ---- cache access ----

    def __contains__(self, url: str) -> bool:
        with self._lock:
            return url in self._entries

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)

    def get(self, url: str) -> Any:
        with self._lock:
            return self._entries.get(url)

    def put(self, url: str, data: Any) -> None:
        with self._lock:
            self._entries[url] = data
        self.save()

    # ---- processed tracking ----

    def mark_processed(self, event_id: int) -> None:
        with self._lock:
            self._processed.add(event_id)

    def is_processed(self, event_id: int) -> bool:
        with self._lock:
            return event_id in self._processed

    def reset_processed_to(self, event_ids: set[int]) -> None:
        with self._lock:
            self._processed = set(event_ids)

    # ---- persistence ----

    def save(self, force: bool = False) -> None:
        """Write to disk, throttled unless force=True."""
        with self._lock:
            if not force and self._writes < self._soft_write_limit:
                return
            payload = dict(self._entries)
            payload[CACHE_PROCESSED_KEY] = sorted(self._processed)
            tmp = self._path.with_suffix(self._path.suffix + ".tmp")
            with open(tmp, "w") as f:
                json.dump(payload, f)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self._path)
            self._writes += 1
