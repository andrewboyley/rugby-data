"""Command-line entry points for the rugby composition predictor."""

import argparse
import sys
from pathlib import Path

from .api import EspnApi
from .builder import DatasetBuilder
from .cache import ApiCache
from .config import (
    DEFAULT_CACHE_PATH,
    DEFAULT_DATASET_PATH,
    DEFAULT_GRAPH_PATH,
    INTERNATIONAL_TEAM_IDS,
)
from .dataset import Dataset
from .graph import CoOccurrenceGraph
from .reporting import RichProgressBar
from .rims_api import RimsApi


def build_dataset(
    dataset_path: Path = DEFAULT_DATASET_PATH,
    cache_path: Path = DEFAULT_CACHE_PATH,
    team_ids: list[str] | None = None,
    source: str = "rims-first",
) -> None:
    cache = ApiCache(cache_path)
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

    with RichProgressBar() as progress:
        builder.build(progress)


def build_graph(
    dataset_path: Path = DEFAULT_DATASET_PATH,
    graph_path: Path = DEFAULT_GRAPH_PATH,
) -> None:
    dataset = Dataset.load(dataset_path)
    graph = CoOccurrenceGraph(dataset, dataset_path)
    graph.save(graph_path)
    print(graph.summarize())
    print(f"\nwrote {graph_path}")


def main(argv=None) -> None:
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except AttributeError:
        pass

    parser = argparse.ArgumentParser(
        prog="rugby-composition-predictor",
        description="Build a dataset and co-occurrence graph of "
        "international rugby matches.",
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

    graph_cmd = sub.add_parser("graph", help="build graph.json")
    graph_cmd.add_argument(
        "--input",
        default=DEFAULT_DATASET_PATH,
        help="dataset input (default: %(default)s)",
    )
    graph_cmd.add_argument(
        "--output",
        default=DEFAULT_GRAPH_PATH,
        help="graph output (default: %(default)s)",
    )

    args = parser.parse_args(argv)

    if args.command == "dataset":
        team_ids = [args.team] if args.team else None
        build_dataset(
            Path(args.output),
            Path(args.cache),
            team_ids=team_ids,
            source=args.source,
        )
    elif args.command == "graph":
        build_graph(Path(args.input), Path(args.output))
