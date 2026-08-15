"""Application-wide configuration and constants."""

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"

CORE_API_BASE = "https://sports.core.api.espn.com/v2/sports/rugby"

# ESPN "site web" API (site.web.api.espn.com) — the editorial/site endpoint
# that powers espn.com's public pages (incl. the lineups page). Unlike the
# CORE API above, its event `summary` response carries rugby rosters inline.
SITE_WEB_API_BASE = "https://site.web.api.espn.com/apis/site/v2/sports/rugby"
SOUTH_AFRICA_TEAM_ID = "5"
YEARS = range(2016, 2027)

# International (national) rugby union teams. Seeded from the Rugby World Cup
# participants across recent editions; match discovery iterates these teams so
# any competition a national team enters is captured regardless of new leagues.
INTERNATIONAL_TEAM_IDS = [
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "8",
    "9",
    "10",
    "11",
    "12",
    "14",
    "15",
    "16",
    "20",
    "23",
    "25",
    "27",
    "29",
    "57",
    "81",
    "82",
    "289243",
]

# Home kit colours for national teams, keyed by ESPN team id. The ESPN API
# `color` field is a brand/logo colour, which does not always match the
# jersey the team wears at home, so curated overrides take precedence.
HOME_KIT_COLOURS: dict[str, str] = {
    "1": "#FFFFFF",  # England — white
    "2": "#003778",  # Scotland — navy blue
    "3": "#169B62",  # Ireland — green
    "4": "#C8102E",  # Wales — red
    "5": "#007A33",  # South Africa — Springbok green
    "6": "#FFB81C",  # Australia — Wallabies gold
    "8": "#000000",  # New Zealand — black
    "9": "#1E2952",  # France — navy blue
    "10": "#75AADB",  # Argentina — celeste blue
    "11": "#FF0000",  # USA — red
    "12": "#FFCD00",  # Romania — yellow
    "14": "#FFFFFF",  # Fiji — white
    "15": "#00529F",  # Samoa — blue
    "16": "#C8102E",  # Tonga — red
    "20": "#0072CE",  # Italy — azzurro
    "23": "#BC002D",  # Japan — red
    "25": "#D52B1E",  # Canada — red
    "27": "#E30613",  # Portugal — red
    "29": "#6EC4E8",  # Uruguay — sky blue
    "57": "#FF0000",  # Russia — red
    "81": "#E4002B",  # Georgia — red
    "82": "#003580",  # Namibia — blue
    "33": "#FFDF00",  # Brazil — yellow
    "289211": "#AA151B",  # Spain — red
    "289243": "#C8102E",  # Chile — red
    "289267": "#DA2128",  # Belgium — red
    "289210": "#000000",  # Kenya — black
    "289268": "#004A9F",  # Hong Kong — blue
    "289324": "#FF7A00",  # Netherlands — orange
    "289356": "#009A4E",  # Zimbabwe — green
    "289454": "#C60B1E",  # Korea Republic — red
    "289514": "#CE1126",  # Paraguay — red
    "289530": "#009E49",  # Burkina Faso — green
}

# Secondary home/brand colour for each national team, keyed by ESPN team id.
# The second colour of the team's identity (e.g. South Africa's gold),
# exposed as `alternateColor`.
SECONDARY_KIT_COLOURS: dict[str, str] = {
    "1": "#002147",  # England — navy
    "2": "#FFFFFF",  # Scotland — white
    "3": "#FFFFFF",  # Ireland — white
    "4": "#FFFFFF",  # Wales — white
    "5": "#FFB81C",  # South Africa — gold
    "6": "#00843D",  # Australia — green
    "8": "#FFFFFF",  # New Zealand — white
    "9": "#ED2939",  # France — red
    "10": "#FFFFFF",  # Argentina — white
    "11": "#002868",  # USA — navy
    "12": "#CE1126",  # Romania — red
    "14": "#000000",  # Fiji — black
    "15": "#CE1126",  # Samoa — red
    "16": "#FFFFFF",  # Tonga — white
    "20": "#FFFFFF",  # Italy — white
    "23": "#002654",  # Japan — navy
    "25": "#FFFFFF",  # Canada — white
    "27": "#046A38",  # Portugal — green
    "29": "#FFFFFF",  # Uruguay — white
    "57": "#FFFFFF",  # Russia — white
    "81": "#FFFFFF",  # Georgia — white
    "82": "#D21034",  # Namibia — red
    "33": "#009739",  # Brazil — green
    "289211": "#FFC400",  # Spain — yellow
    "289243": "#FFFFFF",  # Chile — white
    "289267": "#FDDA24",  # Belgium — yellow
    "289210": "#CE1126",  # Kenya — red
    "289268": "#E4002B",  # Hong Kong — red
    "289324": "#FFFFFF",  # Netherlands — white
    "289356": "#FFB81C",  # Zimbabwe — gold
    "289454": "#003478",  # Korea Republic — blue
    "289514": "#FFFFFF",  # Paraguay — white
    "289530": "#FFD100",  # Burkina Faso — yellow
    "32": "#FFFFFF",  # British and Irish Lions — white
    "7": "#DD0000",  # Germany — red
    "162": "#FFFFFF",  # Italy A — white
    "141138": "#FFFFFF",  # Argentina Jaguars — white
    "264769": "#000000",  # Fiji Warriors — black
}

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

# World Rugby RIMS API (api.wr-rims-prod.pulselive.com) — primary datasource
RIMS_API_BASE = "https://api.wr-rims-prod.pulselive.com/rugby/v3"
RIMS_HEADERS = {
    "account": "worldrugby",
    "x-pulse-application-version": "v1.7.5",
    "x-pulse-application-name": "web",
    "origin": "https://www.world.rugby",
    "referer": "https://www.world.rugby/",
}
RIMS_RATE_LIMIT_PER_MIN = 45
RIMS_MAX_WORKERS = 1

# RIMS team ids for international teams (primary 15s sides).
# Keys are ESPN team ids (str), values are RIMS team ids (str).
# Sourced from RIMS match data and team listing (type=Country).
RIMS_TEAM_IDS: dict[str, str] = {
    "1": "34",  # England
    "2": "35",  # Scotland
    "3": "36",  # Ireland
    "4": "33",  # Wales
    "5": "39",  # South Africa
    "6": "38",  # Australia
    "8": "37",  # New Zealand
    "9": "42",  # France
    "10": "40",  # Argentina
    "11": "51",  # USA
    "12": "52",  # Romania
    "14": "46",  # Fiji
    "15": "45",  # Samoa
    "16": "47",  # Tonga
    "20": "41",  # Italy
    "23": "49",  # Japan
    "25": "50",  # Canada
    "27": "44",  # Portugal
    "29": "68",  # Uruguay
    "57": "756",  # Russia
    "81": "720",  # Georgia
    "82": "58",  # Namibia
    "33": "703",  # Brazil
    "289211": "43",  # Spain
    "289243": "708",  # Chile
    "289267": "699",  # Belgium
    "289210": "735",  # Kenya
    "289268": "725",  # Hong Kong
    "289324": "64",  # Netherlands
    "289356": "57",  # Zimbabwe
    "289454": "736",  # Korea
    "289514": "751",  # Paraguay
    "289530": "2389",  # Burkina Faso
}
