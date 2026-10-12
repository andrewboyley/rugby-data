"""Atomic, crash-safe JSON persistence."""

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def _atomic_write(path: Path, write) -> None:
    """Write to a unique temp file beside `path`, then atomically replace it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            write(f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def atomic_write_json(path: Path, data: Any, indent: int = 2) -> None:
    """Write data to path atomically via a temp file + rename."""
    _atomic_write(path, lambda f: json.dump(data, f, indent=indent))


def atomic_write_text(path: Path, text: str) -> None:
    """Write text to path atomically via a temp file + rename."""
    _atomic_write(path, lambda f: f.write(text))


def load_json(path: Path, default: Any = None) -> Any:
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return default
