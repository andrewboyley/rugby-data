"""Atomic, crash-safe JSON persistence."""

import json
import os
from pathlib import Path
from typing import Any


def atomic_write_json(path: Path, data: Any, indent: int = 2) -> None:
    """Write data to path atomically via a temp file + rename."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w") as f:
        json.dump(data, f, indent=indent)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def atomic_write_text(path: Path, text: str) -> None:
    """Write text to path atomically via a temp file + rename."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def load_json(path: Path, default: Any = None) -> Any:
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return default
