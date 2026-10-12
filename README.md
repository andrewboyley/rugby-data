# Rugby Data

Builds a versioned dataset of international rugby union matches from World Rugby
RIMS and ESPN. It is a data pipeline, not a predictor.

`dataset.json` is the current product boundary. A local API serves this same
contract without creating a second graph export.

## Setup

```sh
just setup
```

Requirements: [uv](https://docs.astral.sh/uv/) and
[just](https://github.com/casey/just).

## Build a dataset

```sh
just dataset
```

Use `--team <id>` for one team. Builds resume from `data/api_cache.json`.
`--reset` rebuilds from cached responses without downloading again. Use
`--refresh` to clear the cache and processed markers, then fetch upstream again:

```sh
just dataset -- --refresh
```

`--reset` and `--refresh` cannot be combined. Do not commit the generated dataset
or API cache.

## Serve the dataset

```sh
just serve
```

The optional server binds to `127.0.0.1:8000` and only serves the existing local
artifact; it never rebuilds or calls upstream APIs. Build or refresh in a separate
command. Atomic dataset writes are detected on the next request without restarting
server.

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

Responses are JSON. Unknown paths return `404`; non-GET requests return `405`.
`/dataset` supports ETag revalidation.

## Contract

Generated `data/dataset.json` is versioned:

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
- Team IDs are numeric, serialized as JSON object keys in registries.
- A game is emitted only with two competitors, non-empty rosters, and both
  scores.
- Dates use source ISO-8601 timestamps when supplied.
- Roster jersey numbers 1–15 are starters; 16–23 are bench players.

Consumers should reject unsupported future schema versions. During migration,
`Dataset.load()` still accepts prior unversioned files.

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

`DatasetBuilder` is a thin facade that composes single-purpose mixins:
discovery (`build_discovery.py`), fetch orchestration and RIMS-first fallback
(`game_fetch.py`, `build_run.py`), RIMS parsing (`rims_game.py`,
`rims_entities.py`), ESPN site-web parsing (`espn_game.py`), reporting
(`build_reporting.py`), and the negative cache (`build_cache.py`).

Raw responses stay in the local cache. Only the versioned dataset contract is
intended for application or future API consumers.

## Development Tools

- **Superpowers**: Guides structured development with planning, TDD, and parallel subagents. Plans live in `docs/superpowers/plans/`.
- **repowise**: Codebase health, evolution insights, and code review context.
- **ccc** (CocoIndex Code): Semantic code search — finds code by meaning, not keyword. Run `ccc search <query>` from the project root.
- **Codegraph**: Explores call paths, symbol definitions, and cross-file relationships. Run `codegraph explore "<query>"`.

## Contributing

This project uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

```
<type>[optional scope]: <description>

Types: feat, fix, docs, refactor, test, chore, perf, ci, revert
```

Examples: `feat(api): add health endpoint`, `fix(transport): handle 429 retry delay`, `docs: update README`.

Pre-commit hooks validate commit messages and run lint automatically:

```sh
just install-hooks  # install once
```
