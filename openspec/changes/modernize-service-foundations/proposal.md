## Why

The pipeline now needs both reliable upstream refreshes and a local API, but its HTTP, API, CLI, and contract plumbing is hand-written. Adopt mature tools so project work stays focused on rugby-source extraction and the versioned dataset contract.

## What Changes

- Add explicit `dataset --refresh` behavior that discards stale raw responses and processed markers before rebuilding from upstream.
- Add a read-only local API serving the schema-v1 artifact and direct contract fragments with hot reload, ETags, and last-known-good behavior.
- Replace custom HTTP serving with FastAPI/Uvicorn, upstream requests with HTTPX/Tenacity, CLI parsing with Typer, and dataset contract models with Pydantic.
- Preserve schema version 1, cache file format, incremental checkpoints, source-specific rate limiting, complete-game filtering, and ignored generated data.
- **BREAKING:** internal Python APIs for model construction/serialization and CLI implementation will change; generated dataset JSON and command intent remain compatible.

## Capabilities

### New Capabilities
- `dataset-refresh`: Explicit upstream refresh of the local versioned dataset.
- `dataset-api`: Read-only HTTP delivery and contract-fragment lookup for the generated dataset.
- `dataset-contract-validation`: Pydantic-backed validation and schema publication for dataset version 1.

### Modified Capabilities
- None.

## Impact

- Affects `pyproject.toml`, `uv.lock`, CLI, transport, server, models, dataset loading/saving, cache persistence, tests, `justfile`, README, and project instructions.
- Adds FastAPI/Uvicorn, HTTPX, Tenacity, Typer, and Pydantic runtime dependencies.
- Leaves raw API cache content local and unexposed; no generated data is committed.
