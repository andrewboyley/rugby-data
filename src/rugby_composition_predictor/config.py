"""Application-wide configuration and constants."""

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"

CORE_API_BASE = "https://sports.core.api.espn.com/v2/sports/rugby"
SOUTH_AFRICA_TEAM_ID = "5"
YEARS = range(2016, 2027)

DEFAULT_DATASET_PATH = DATA_DIR / "dataset.json"
DEFAULT_GRAPH_PATH = DATA_DIR / "graph.json"
DEFAULT_CACHE_PATH = DATA_DIR / "api_cache.json"

DEFAULT_MAX_WORKERS = 8
DEFAULT_SAVE_EVERY = 10

REQUEST_TIMEOUT_SECONDS = 30
RETRY_ATTEMPTS = 4
USER_AGENT = "Mozilla/5.0"

CACHE_SOFT_WRITE_LIMIT = 100
CACHE_PROCESSED_KEY = "__processed__"
