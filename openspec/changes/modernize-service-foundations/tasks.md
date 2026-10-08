## 1. Dependencies and contract models

- [ ] 1.1 Add and lock FastAPI/Uvicorn, HTTPX, Tenacity, Typer, and Pydantic dependencies.
- [ ] 1.2 Convert schema-v1 public dataset models and serialization to Pydantic aliases while retaining unversioned-load compatibility.
- [ ] 1.3 Add contract and JSON-schema validation tests for complete-game filtering and identifier preservation.

## 2. Refresh and cache persistence

- [ ] 2.1 Implement explicit refresh cache invalidation while retaining cache-only reset and default resumable behavior.
- [ ] 2.2 Reuse atomic JSON persistence for cache checkpoints and retain cache recovery, marker, and negative-fact semantics.
- [ ] 2.3 Add deterministic refresh/cache compatibility coverage.

## 3. Upstream transport

- [ ] 3.1 Replace urllib transport with reusable HTTPX clients while preserving source headers, activity reporting, cache-first behavior, and timeouts.
- [ ] 3.2 Replace hand-written retry mechanics with Tenacity while preserving retryable status/decode rules and RIMS-specific 429 policy.
- [ ] 3.3 Add mocked transport coverage for cache hits, success, retryable failures, terminal 4xx, and invalid JSON.

## 4. API and CLI

- [ ] 4.1 Replace manual HTTP server with FastAPI application factory and validated last-known-good artifact snapshot.
- [ ] 4.2 Implement schema artifact, health, and contract-fragment routes with ETag conditional retrieval and reload behavior.
- [ ] 4.3 Replace argparse definitions with Typer commands while preserving dataset and serve command intent.
- [ ] 4.4 Rewrite API and CLI tests using framework test clients and command runners.

## 5. Documentation and verification

- [ ] 5.1 Update README, AGENTS, and Just recipes for refresh and local API operations.
- [ ] 5.2 Remove superseded custom plumbing and unrelated formatter-only diff noise.
- [ ] 5.3 Run `uv sync`, `just lint`, `just check`, `just test`, and OpenSpec validation; confirm generated data/cache remain untracked.
