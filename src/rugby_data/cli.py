"""Command-line entry points for the rugby composition predictor."""

import argparse
import io
import sys
from pathlib import Path

from .api import EspnApi
from .builder import NEG_FAIL_PREFIX, DatasetBuilder
from .cache import ApiCache
from .config import (
    DEFAULT_CACHE_PATH,
    DEFAULT_DATASET_PATH,
    INTERNATIONAL_TEAM_IDS,
)
from .dataset import Dataset
from .reporting import RichProgressBar
from .rims_api import RimsApi
from .server import DatasetServer


def build_dataset(
    dataset_path: Path = DEFAULT_DATASET_PATH,
    cache_path: Path = DEFAULT_CACHE_PATH,
    team_ids: list[str] | None = None,
    source: str = "rims-first",
    reset: bool = False,
    skip_failed: bool = False,
    refresh: bool = False,
) -> None:
    cache = ApiCache(cache_path)
    if refresh:
        cache.clear()
        dataset = Dataset()
        print("== Refresh: cleared local cache and rebuilding from upstream ==")
    elif reset:
        # Forget which events were already processed AND start from an empty
        # dataset, so every discovered event is re-derived from the cached raw
        # responses. This discards any stale data from a previous schema (e.g.
        # source-prefixed ids) and re-runs the parse/merge. No re-download.
        cache.reset_processed_to(set())
        # Also drop the permanently-failed markers so --reset truly re-checks
        # every match (the ESPN-fallback negatives are kept to avoid re-search).
        cache.delete_prefix(NEG_FAIL_PREFIX)
        dataset = Dataset()
        print("== Reset: cleared processed markers; rebuilding from empty dataset ==")
    else:
        dataset = Dataset.load(dataset_path)
    espn_api = EspnApi(cache)
    rims_api = RimsApi(cache)
    builder = DatasetBuilder(
        rims_api,
        espn_api,
        cache,
        dataset,
        dataset_path,
        team_ids=team_ids,
        source=source,
    )

    if team_ids:
        scope = ", ".join(team_ids)
    else:
        scope = f"all {len(INTERNATIONAL_TEAM_IDS)} international teams"
    print("== International rugby dataset builder ==")
    print(f"  Teams:    {scope}")
    print(f"  Output:   {dataset_path}")
    print(f"  Cache:    {cache_path} ({len(cache)} entries loaded)")
    print()

    try:
        with RichProgressBar() as progress:
            builder.build(progress, skip_failed=skip_failed)
    finally:
        builder.close()


def main(argv=None) -> None:
    try:
        if isinstance(sys.stdout, io.TextIOWrapper):
            sys.stdout.reconfigure(line_buffering=True)
    except (AttributeError, ValueError):
        pass

    parser = argparse.ArgumentParser(
        prog="rugby-data",
        description="Build an international rugby match dataset.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    dataset_cmd = sub.add_parser("dataset", help="build dataset.json")
    dataset_cmd.add_argument(
        "--output",
        default=DEFAULT_DATASET_PATH,
        help="output path (default: %(default)s)",
    )
    dataset_cmd.add_argument(
        "--cache", default=DEFAULT_CACHE_PATH, help="cache path (default: %(default)s)"
    )
    dataset_cmd.add_argument(
        "--team",
        default=None,
        help="restrict to a single team id (default: all international teams)",
    )
    dataset_cmd.add_argument(
        "--source",
        default="rims-first",
        choices=["rims-first", "rims", "espn"],
        help="data source: rims-first (default), rims, or espn",
    )
    dataset_cmd.add_argument(
        "--reset",
        action="store_true",
        help="clear processed-event markers and re-derive the dataset from "
        "the API cache (no re-download; use after deleting dataset.json)",
    )
    dataset_cmd.add_argument(
        "--skip-failed",
        action="store_true",
        help="skip matches previously recorded as permanently unresolvable "
        "(RIMS has no roster and no usable ESPN fallback)",
    )
    dataset_cmd.add_argument(
        "--refresh",
        action="store_true",
        help="clear local cache and processed markers, then fetch upstream again",
    )

    serve_cmd = sub.add_parser("serve", help="serve dataset.json over HTTP")
    serve_cmd.add_argument(
        "--dataset",
        default=DEFAULT_DATASET_PATH,
        help="dataset path (default: %(default)s)",
    )
    serve_cmd.add_argument("--host", default="127.0.0.1", help="bind host")
    serve_cmd.add_argument("--port", default=8000, type=int, help="bind port")

    args = parser.parse_args(argv)
    if args.command == "dataset" and args.reset and args.refresh:
        parser.error("--reset and --refresh cannot be used together")

    if args.command == "dataset":
        team_ids = [args.team] if args.team else None
        build_dataset(
            Path(args.output),
            Path(args.cache),
            team_ids=team_ids,
            source=args.source,
            reset=args.reset,
            skip_failed=args.skip_failed,
            refresh=args.refresh,
        )
    elif args.command == "serve":
        server = DatasetServer((args.host, args.port), Path(args.dataset))
        host, port = server.server_address[:2]
        print(f"Serving dataset at http://{host}:{port}/dataset")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
