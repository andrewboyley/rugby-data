"""Command-line entry points for the rugby composition predictor."""

from pathlib import Path

import typer
import uvicorn

from .api import EspnApi
from .api_app import create_app
from .builder import NEG_FAIL_PREFIX, DatasetBuilder
from .cache import ApiCache
from .config import (
    DEFAULT_CACHE_PATH,
    DEFAULT_DATASET_PATH,
)
from .dataset import Dataset
from .reporting import RichProgressBar
from .rims_api import RimsApi

app = typer.Typer(
    name="rugby-data",
    help="Builds a cached, versioned dataset of international rugby union matches.",
    no_args_is_help=True,
)


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
        cache.reset_processed_to(set())
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
    progress = RichProgressBar()
    try:
        builder.build(progress, skip_failed=skip_failed)
        dataset.save(dataset_path)
    finally:
        builder.close()


@app.command("dataset")
def dataset_command(
    output: Path = typer.Option(
        DEFAULT_DATASET_PATH,
        "--output",
        "-o",
        help="Path to output dataset.json",
    ),
    cache: Path = typer.Option(
        DEFAULT_CACHE_PATH,
        "--cache",
        "-c",
        help="Path to API response cache file",
    ),
    team: list[str] | None = typer.Option(
        None,
        "--team",
        "-t",
        help="Team ID to build (can specify multiple times).",
    ),
    source: str = typer.Option(
        "rims-first",
        "--source",
        "-s",
        help="Data source mode: rims-first (default), espn-only, rims-only",
    ),
    reset: bool = typer.Option(
        False,
        "--reset",
        help="Rebuild dataset from cached responses without re-downloading",
    ),
    skip_failed: bool = typer.Option(
        False,
        "--skip-failed",
        help="Skip events that previously failed or were not found in ESPN",
    ),
    refresh: bool = typer.Option(
        False,
        "--refresh",
        help="Clear cache and re-download all data from upstream",
    ),
) -> None:
    """Build the international rugby dataset."""
    if reset and refresh:
        typer.echo("Error: --reset and --refresh cannot be used together")
        raise typer.Exit(code=2)

    build_dataset(
        dataset_path=output,
        cache_path=cache,
        team_ids=team,
        source=source,
        reset=reset,
        skip_failed=skip_failed,
        refresh=refresh,
    )


@app.command("serve")
def serve_command(
    dataset: Path = typer.Option(
        DEFAULT_DATASET_PATH,
        "--dataset",
        "-d",
        help="Path to dataset.json artifact",
    ),
    host: str = typer.Option(
        "127.0.0.1",
        "--host",
        help="Host to bind the server to",
    ),
    port: int = typer.Option(
        8000,
        "--port",
        help="Port to bind the server to",
    ),
) -> None:
    """Serve the local versioned dataset over HTTP."""
    app_instance = create_app(Path(dataset))
    print(f"Serving dataset at http://{host}:{port}/dataset")
    uvicorn.run(app_instance, host=host, port=port, log_level="warning")


def main(args: list[str] | None = None) -> None:
    """Entry point for console script."""
    app(args=args)


if __name__ == "__main__":
    main()
