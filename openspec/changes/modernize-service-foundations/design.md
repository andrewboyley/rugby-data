## Context

See `proposal.md` for motivation. Current code uses `argparse`, `urllib`, a hand-written retry loop, stdlib HTTP handlers, dataclasses, and JSON persistence. Cache markers and negative source facts share a human-readable local JSON cache, so their semantics must remain domain-owned. The generated schema-v1 JSON artifact is the consumer boundary.

## Goals / Non-Goals

**Goals:**
- Replace generic HTTP/API/CLI/model plumbing with supported libraries.
- Preserve dataset JSON, cache format, source selection, complete-game filtering, atomic saves, and local-only generated data.
- Keep API reload and conditional-response behavior while removing manual HTTP routing.

**Non-Goals:**
- Redesign the dataset schema or source data model.
- Move cache state to a database or expose it through the API.
- Replace source-specific extraction, RIMS rate limiting, or builder concurrency.

## Decisions

### FastAPI and Uvicorn for artifact delivery
A FastAPI application factory will replace the manual HTTP server. Route declarations, status handling, JSON response framing, OpenAPI, and test client come from the framework. A small snapshot service remains responsible for artifact reload, last-valid retention, pre-encoded body, ETag, and game index. Uvicorn runs it from the existing `serve` command.

Starlette was considered for a smaller surface, but FastAPI supplies typed routes and documentation needed for the intended API path. Pydantic response models are not used for full-artifact responses because raw schema-v1 JSON must remain exact.

### HTTPX and Tenacity for upstream requests
A reusable synchronous HTTPX client replaces `urllib` and supplies pooling, timeout configuration, response classification, and mock transports. Tenacity owns retries and exponential waits. The transport retains URL-keyed cache integration, source descriptions, activity tracking, non-retryable 4xx rules, and RIMS-specific 429 delay behavior.

`requests` was not selected because FastAPI tooling already introduces HTTPX-compatible test utilities. HTTPX retries alone do not cover all existing status/decode policy; Tenacity provides that policy extension point.

### Typer for command definitions
Typer replaces parser boilerplate while preserving command names and option intent: `dataset` retains output/cache/team/source/reset/skip-failed/refresh; `serve` retains dataset/host/port. Tests use its CLI runner. Programmatic `build_dataset()` remains orchestration entry point for direct tests.

### Pydantic v2 for dataset contract models
Public artifact models become strict Pydantic models with aliases for existing camelCase fields. `Dataset.load()` validates unversioned and version-1 mappings; save serializes aliases exactly. Source payloads stay normalized by existing extraction code until their external formats are explicitly modeled.

### Preserve local persistence and cache semantics
`storage.py` remains atomic persistence owner, and `ApiCache` retains raw response keys, processed markers, negative facts, checkpoints, and corrupt-cache quarantine. Cache persistence reuses atomic JSON writing rather than duplicating temp-file code. Rate limiting and `ThreadPoolExecutor` remain because both encode source/build behavior rather than generic plumbing.

## Risks / Trade-offs

- [Dependency expansion] → Pin through `uv`, lock all transitive packages, and retain deterministic offline tests.
- [Pydantic coercion changes contract handling] → use strict validation for generated v1 artifacts, aliases, and compatibility fixtures for unversioned artifacts.
- [Retry migration changes source behavior] → test mock responses for 429, 5xx, invalid JSON, terminal 4xx, and cache hits before deleting old transport code.
- [Multiple server workers hold separate snapshots] → each request checks the atomic artifact path; document local single-worker default and avoid mutable API state.

## Migration Plan

1. Add and lock dependencies; add framework-oriented tests before deleting custom infrastructure.
2. Convert models/dataset serialization with fixture compatibility tests.
3. Convert artifact API and CLI serve path; preserve endpoint behavior and reload guarantees.
4. Convert upstream transport and retry handling; preserve cache and rate-limit semantics.
5. Reuse atomic cache persistence, remove obsolete custom code and unrelated formatter churn, then run full checks.
6. Roll back by reverting the change; artifacts/cache remain schema- and format-compatible.
