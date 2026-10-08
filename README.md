# Rugby Data

Builds a versioned dataset of international rugby union matches from World Rugby
RIMS and ESPN. It is a data pipeline, not a predictor.

`dataset.json` is the current product boundary. A later API can serve this same
contract without changing its consumers.

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
`--reset` rebuilds from cached responses without downloading again. Do not commit
the generated dataset or API cache.

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

Raw responses stay in the local cache. Only the versioned dataset contract is
intended for application or future API consumers.
