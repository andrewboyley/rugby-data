# Rugby Data

Builds a cached, versioned dataset of international rugby union matches from
World Rugby RIMS and ESPN. It is a data pipeline, not a predictor.

## Stack

- Python 3.12+ package in `src/rugby_data/`.
- Generated `data/dataset.json` is a versioned consumer artifact.
- API cache and generated data remain local and ignored.

## Commands

```sh
just setup
just dataset
just check
just test
just lint
```

## Data contract

`Dataset.save()` writes `schemaVersion: 1`, `generatedAt`, games, and entity
registries. Event, player, coach, venue, and league identifiers remain source
strings; team IDs are numeric. Keep only complete games.

A future API must serve this contract rather than creating a second graph
export.

## Rules

- Do not hand-edit generated data under `data/`.
- Preserve incremental saves, processed markers, and cache behavior.
- Never commit API responses, generated data, credentials, or local state.
- Do not commit, amend, or push unless asked.
