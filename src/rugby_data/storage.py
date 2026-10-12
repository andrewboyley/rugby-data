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
        _write_and_sync(fd, write)
        os.replace(tmp, path)
        _fsync_directory(path.parent)
    except BaseException:
        _remove_quietly(tmp)
        raise


def _write_and_sync(fd: int, write) -> None:
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        write(f)
        f.flush()
        os.fsync(f.fileno())


def _fsync_directory(directory: Path) -> None:
    directory_fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def _remove_quietly(tmp: str) -> None:
    try:
        os.unlink(tmp)
    except OSError:
        # The temp file may already be gone; nothing further to clean up.
        return


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
