<div align="center">

<h1>🏉 Rugby Data</h1>

<p><strong>International rugby match data, ready to consume.</strong><br />
Build a cached, versioned JSON dataset from World Rugby RIMS and ESPN.</p>

<p>
  <a href="https://www.python.org/"><img src="https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&logoColor=white" alt="Python 3.12+"></a>
  <a href="https://fastapi.tiangolo.com/"><img src="https://img.shields.io/badge/FastAPI-read--only%20API-009688?logo=fastapi&logoColor=white" alt="FastAPI read-only API"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License"></a>
</p>

[Quick start](#quick-start) · [Build options](#build-options) · [API](#local-api) · [Data contract](#data-contract) · [Development](#development)

</div>

## One artifact, one contract

Rugby Data builds a single JSON artifact containing international rugby union
matches and their related teams, players, venues, leagues, and coaches. It
collects data from [World Rugby RIMS](https://www.world.rugby/) and ESPN, keeps
raw source responses in a local cache, and can resume interrupted builds.

The project is a **data pipeline**, not a result-prediction service. Its product
boundary is `data/dataset.json`; the optional local API serves that same
versioned artifact without downloading data or exposing the cache.

```text
rugby-data CLI → DatasetBuilder → RIMS / ESPN → local cache → dataset.json → read-only API
```

## Highlights

| | Capability | Details |
| --- | --- | --- |
| 🏉 | International match data | Discovers and builds complete matches, with RIMS as the default source and ESPN support where needed. |
| ♻️ | Resumable builds | Persists raw responses and processed-event markers locally, so routine runs reuse prior work. |
| 📦 | Stable consumer artifact | Writes an atomic, schema-versioned JSON dataset with entity registries. |
| 🌐 | Read-only local API | Serves the artifact with entity endpoints, ETags, and automatic reload after an atomic update. |
| ✅ | Developer workflow | Uses `uv`, `just`, Ruff, ty, pytest, and pre-commit hooks. |

## Quick start

### Prerequisites

- Python 3.12 or later
- [uv](https://docs.astral.sh/uv/)
- [just](https://github.com/casey/just)

### Install and build

```sh
just setup
just dataset
```

The first build downloads source data and writes `data/dataset.json`. Local
generated data and the API-response cache are intentionally ignored by Git.

Build one or more teams instead of the full configured set:

```sh
just dataset -- --team 1 --team 2
```

### Serve the artifact

```sh
just serve
```

The server listens at `http://127.0.0.1:8000` by default. Once a dataset exists:

```sh
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/dataset
```

## Build options

`just dataset` passes options to `rugby-data dataset`:

| Option | Meaning |
| --- | --- |
| `--team <id>` | Build a team; may be specified more than once. |
| `--source <mode>` | Select `rims-first` (default), `espn-only`, or `rims-only`. |
| `--reset` | Rebuild from cached responses, clearing processed markers without downloading again. |
| `--refresh` | Clear the cache and rebuild from upstream sources. |
| `--skip-failed` | Skip events previously recorded as failed or absent from ESPN. |
| `--output <path>` | Write the dataset artifact to a different path. |
| `--cache <path>` | Store raw API responses in a different cache file. |

For example, force a fully fresh build:

```sh
just dataset -- --refresh
```

`--reset` and `--refresh` cannot be used together. Do not edit generated files
under `data/` by hand or commit generated data, API responses, credentials, or
other local state.

## Local API

The API is read-only: it only reads the existing dataset artifact. It never
builds a dataset, calls an upstream source, or exposes the API cache. It reloads
the artifact on the next request after an atomic dataset write.

| Endpoint | Response |
| --- | --- |
| `GET /health` | Status, schema version, and generation time |
| `GET /dataset` | The exact versioned `dataset.json` contract |
| `GET /games/{eventId}` | One game |
| `GET /teams/{teamId}` | One team registry entry |
| `GET /players/{playerId}` | One player registry entry |
| `GET /venues/{venueId}` | One venue registry entry |
| `GET /leagues/{leagueId}` | One league registry entry |
| `GET /coaches/{coachId}` | One coach registry entry |

Successful `GET` responses include an ETag and support conditional requests.
Unknown entities return `404`.

## Data contract

`Dataset.save()` writes schema version 1 and an ISO-8601 UTC generation time:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-08T12:00:00Z",
  "games": [],
  "teams": {},
  "players": {},
  "venues": {},
  "leagues": {},
  "coaches": {}
}
```

- Event, player, coach, venue, and league IDs remain source strings.
- Team IDs are numbers in the application and JSON object keys in the artifact.
- Only complete games are retained: two competitors, rosters for both sides, and
  both scores are required.
- Matchday jersey numbers 1–15 are starters; 16–23 are replacements.
- Consumers should reject schema versions they do not support.

## How it works

The builder coordinates discovery, fetch orchestration, source parsing, entity
registration, reporting, and periodic persistence. RIMS is the primary source;
ESPN provides supported fallback and lineup data. The raw upstream responses
remain local—only the versioned dataset is intended for consumers.

## Development

```sh
just check  # type-check and compile source
just test   # run tests
just lint   # lint and check formatting
just hooks  # run all pre-commit hooks
```

Install Git hooks once per clone:

```sh
just install-hooks
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/),
for example `fix(transport): handle 429 retry delay`.

For codebase exploration, the repository also maintains a Repowise wiki plus
ccc semantic search and CodeGraph call-path indexes:

```sh
repowise search "dataset contract"
ccc search "cache-aware dataset build"
codegraph explore "build_dataset create_app"
```

## License

Released under the [MIT License](LICENSE).
