# Rugby Data

Builds a cached, versioned dataset of international rugby union matches from
World Rugby RIMS and ESPN. It is a data pipeline, not a predictor.

## Stack

- Python 3.12+ package in `src/rugby_data/`.
- Generated `data/dataset.json` is a versioned consumer artifact.
- API cache and generated data remain local and ignored.
- Modernized tooling: FastAPI/Uvicorn for API, HTTPX/Tenacity for transport, Typer for CLI, Pydantic v2 for data models.

## Commands

```sh
just setup          # install dependencies
just dataset        # build dataset
just check          # type check
just test           # run tests
just lint           # lint and format check
just install-hooks  # install pre-commit hooks (once per clone)
just hooks          # run all hooks manually
```

## Data contract

`Dataset.save()` writes `schemaVersion: 1`, `generatedAt`, games, and entity
registries. Event, player, coach, venue, and league identifiers remain source
strings; team IDs are numeric. Keep only complete games.

The optional API must serve this contract rather than creating a second graph
export. It is read-only and must not expose the API cache or trigger upstream fetches.

## Rules

- Do not hand-edit generated data under `data/`.
- Preserve incremental saves, processed markers, and cache behavior.
- Never commit API responses, generated data, credentials, or local state.
- Do not commit, amend, or push unless asked.
