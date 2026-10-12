"""Deterministic refresh, reset, and cache persistence coverage."""

import json
from pathlib import Path

import pytest

from rugby_data import cli
from rugby_data.builder import NEG_FAIL_PREFIX
from rugby_data.cache import ApiCache
from rugby_data.config import CACHE_PROCESSED_KEY


class RecordingBuilder:
    upstream_builds = 0

    def __init__(self, _rims, _espn, cache, _dataset, _output, **_kwargs):
        self.cache = cache

    def close(self):
        pass

    def build(self, _progress, *, skip_failed=False):
        if "upstream://schedule" not in self.cache:
            type(self).upstream_builds += 1
            self.cache.put(
                "upstream://schedule", {"download": type(self).upstream_builds}
            )
        self.cache.save(force=True)


@pytest.fixture(autouse=True)
def no_progress(monkeypatch):
    class Progress:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr(cli, "RichProgressBar", Progress)
    RecordingBuilder.upstream_builds = 0


def test_build_dataset_closes_builder_when_build_fails(tmp_path, monkeypatch):
    class FailingBuilder:
        instance = None

        def __init__(self, *_args, **_kwargs):
            type(self).instance = self
            self.closed = False

        def build(self, _progress, *, skip_failed=False):
            raise RuntimeError("build failed")

        def close(self):
            self.closed = True

    monkeypatch.setattr(cli, "DatasetBuilder", FailingBuilder)

    with pytest.raises(RuntimeError, match="build failed"):
        cli.build_dataset(tmp_path / "dataset.json", tmp_path / "cache.json")

    assert FailingBuilder.instance is not None
    assert FailingBuilder.instance.closed


def seed_cache(path: Path) -> None:
    cache = ApiCache(path)
    cache.put("upstream://schedule", {"download": 0})
    cache.put(f"{NEG_FAIL_PREFIX}match", {"reason": "no roster"})
    cache.mark_processed("match")
    cache.save(force=True)


def test_refresh_clears_cache_and_processed_marker_before_upstream_rebuild(
    tmp_path, monkeypatch
):
    cache_path = tmp_path / "cache.json"
    seed_cache(cache_path)
    monkeypatch.setattr(cli, "DatasetBuilder", RecordingBuilder)

    cli.build_dataset(tmp_path / "dataset.json", cache_path, refresh=True)

    cache = ApiCache(cache_path)
    assert RecordingBuilder.upstream_builds == 1
    assert cache.get("upstream://schedule") == {"download": 1}
    assert f"{NEG_FAIL_PREFIX}match" not in cache
    assert not cache.is_processed("match")


def test_reset_keeps_raw_cache_without_upstream_and_clears_marker_and_negative(
    tmp_path, monkeypatch
):
    cache_path = tmp_path / "cache.json"
    seed_cache(cache_path)
    monkeypatch.setattr(cli, "DatasetBuilder", RecordingBuilder)

    cli.build_dataset(tmp_path / "dataset.json", cache_path, reset=True)

    cache = ApiCache(cache_path)
    assert RecordingBuilder.upstream_builds == 0
    assert cache.get("upstream://schedule") == {"download": 0}
    assert f"{NEG_FAIL_PREFIX}match" not in cache
    assert not cache.is_processed("match")


def test_reset_and_refresh_usage_error_happens_before_cache_changes(tmp_path):
    cache_path = tmp_path / "cache.json"
    seed_cache(cache_path)
    before = cache_path.read_bytes()

    with pytest.raises(SystemExit) as exc_info:
        cli.main(["dataset", "--cache", str(cache_path), "--reset", "--refresh"])
    assert exc_info.value.code == 2

    assert cache_path.read_bytes() == before


def test_cache_save_uses_shared_atomic_json_writer(tmp_path, monkeypatch):
    cache_path = tmp_path / "cache.json"
    calls = []

    def write(path, payload, indent=2):
        calls.append((path, payload, indent))
        path.write_text(json.dumps(payload, indent=indent))

    monkeypatch.setattr("rugby_data.cache.atomic_write_json", write)
    cache = ApiCache(cache_path, soft_write_limit=1)
    cache.put("url", {"value": 1})

    assert calls == [(cache_path, {"url": {"value": 1}, CACHE_PROCESSED_KEY: []}, 2)]
