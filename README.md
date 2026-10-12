# Rugby Data

This package builds a versioned dataset of international rugby union matches.
The dataset is one JSON file of matches, teams, players, venues, leagues, and
coaches. The build downloads data from World Rugby RIMS and ESPN. The package
is a data pipeline. It does not predict results.

`data/dataset.json` is the product boundary. The product boundary is the file
that consumers read. A local API serves the same contract. The contract is the
fixed structure of the dataset file. The API does not make a second graph
export.

## Setup

Install the dependencies:

```sh
just setup
```

The setup needs [uv](https://docs.astral.sh/uv/) and
[just](https://github.com/casey/just).

## Build a dataset

Build all teams:

```sh
just dataset
```

Add `--team <id>` to build one team. A build continues from the last saved game
and reads the API cache in `data/api_cache.json`. The API cache is a local store
of the raw responses from the sources.

The `just dataset` command also takes these options:

- `--reset` builds the dataset again from the cached responses. It does not
  download again.
- `--refresh` erases the cache and the processed markers. Then it downloads all
  data again from the sources.
- `--source` selects the source mode. The default is `rims-first`. Other values
  are `espn-only` and `rims-only`.
- `--skip-failed` skips events that failed or were not found in ESPN before.

Example:

```sh
just dataset -- --refresh
```

You cannot use `--reset` and `--refresh` together. Do not commit the generated
dataset or the API cache.

## Serve the dataset

Serve the existing dataset:

```sh
just serve
```

The server binds to `127.0.0.1:8000` by default. The server only reads the
local artifact. It never builds the dataset and never calls the sources. Build
or refresh the dataset in a separate command. The server detects an atomic
dataset write on the next request. It does not need a restart.

| Endpoint | Response |
| --- | --- |
| `GET /dataset` | Exact schema-versioned `dataset.json` contract |
| `GET /health` | Status plus artifact schema version and generation time |
| `GET /games/<eventId>` | Contract game fragment |
| `GET /teams/<teamId>` | Team registry fragment |
| `GET /players/<playerId>` | Player registry fragment |
| `GET /venues/<venueId>` | Venue registry fragment |
| `GET /leagues/<leagueId>` | League registry fragment |
| `GET /coaches/<coachId>` | Coach registry fragment |

Responses are JSON. An unknown path returns `404`. A request with a different
method returns `405`. `/dataset` supports ETag revalidation.

## Contract

The generated `data/dataset.json` file has a schema version:

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

- Event, player, coach, venue, and league IDs stay source strings.
- Team IDs are numbers. The registries use them as JSON object keys.
- The build writes a game only when the game has two competitors, a roster on
  each side, and both scores.
- Dates use source ISO-8601 timestamps when the source gives them.
- In a matchday squad, jersey numbers 1 to 15 are starters and 16 to 23 are
  replacements.

Consumers must reject a future schema version that they do not support. During
migration, `Dataset.load()` still accepts older files without a schema version.

## Commands

```sh
just check  # type and bytecode checks
just test   # deterministic contract tests
just lint   # lint source and tests
```

## Pipeline

```text
cli.py → DatasetBuilder → RIMS / ESPN clients → ApiCache → Dataset.save()
```

`DatasetBuilder` is a thin facade. It composes mixins with one purpose each:
discovery (`build_discovery.py`), fetch orchestration and RIMS-first fallback
(`game_fetch.py`, `build_run.py`), RIMS parsing (`rims_game.py`,
`rims_entities.py`), ESPN site-web parsing (`espn_game.py`), reporting
(`build_reporting.py`), and the negative cache (`build_cache.py`).

A mixin is a class fragment that adds methods to one class. The raw responses
stay in the local cache. Only the versioned dataset contract is for other
applications or future API consumers.

## Development tools

The project uses these tools:

- Superpowers guides development with plans, tests, and parallel subagents. The
  plans are in `docs/superpowers/plans/`.
- repowise reports code health, change history, and review context.
- ccc (CocoIndex Code) finds code by meaning, not by keyword. Run
  `ccc search <query>` from the project root.
- Codegraph reads call paths, symbol definitions, and cross-file relations. Run
  `codegraph explore "<query>"`.

## Contributing

The project uses
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

```
<type>[optional scope]: <description>

Types: feat, fix, docs, refactor, test, chore, perf, ci, revert
```

Examples: `feat(api): add health endpoint`, `fix(transport): handle 429 retry delay`, `docs: update README`.

The pre-commit hooks make sure that the commit message has the correct format.
They also run the linter. Install the hooks once:

```sh
just install-hooks
```
