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
)
from .dataset import Dataset
from .graph import CoOccurrenceGraph
from .reporting import RichProgressBar


def build_dataset(
    dataset_path: Path = DEFAULT_DATASET_PATH,
    cache_path: Path = DEFAULT_CACHE_PATH,
) -> None:
    cache = ApiCache(cache_path)
    dataset = Dataset.load(dataset_path)
    api = EspnApi(cache)
    builder = DatasetBuilder(api, cache, dataset, dataset_path)

    print("== South Africa international rugby dataset builder ==")
    print("  Team:     South Africa (id 5)")
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
        "South African international rugby matches.",
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
        build_dataset(Path(args.output), Path(args.cache))
    elif args.command == "graph":
        build_graph(Path(args.input), Path(args.output))
