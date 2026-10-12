# Modernize Service Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize the rugby-data pipeline by replacing custom HTTP/CLI/transport plumbing with FastAPI, HTTPX/Tenacity, Typer, and Pydantic while preserving schema v1 contract, cache semantics, and all existing behavior.

**Architecture:** This plan implements the OpenSpec change `modernize-service-foundations`. We maintain the existing dataset contract and cache format, convert models to Pydantic v2 with aliases for compatibility, migrate upstream transport to HTTPX/Tenacity preserving retry/backoff policy, replace the stdlib HTTP server with FastAPI, and replace argparse with Typer. Tests validate behavioral preservation.

**Tech Stack:** Python 3.12+, FastAPI, Uvicorn, HTTPX, Tenacity, Typer, Pydantic v2, ruff, pytest (via just).

**Spec:** `openspec/changes/modernize-service-foundations/` — see `proposal.md`, `design.md`, `tasks.md` and specs in `specs/dataset-*/spec.md`.

## Global Constraints

- Preserve schema version 1; generated dataset JSON must remain exactly compatible in structure for consumers (camelCase field names preserved via aliases).
- Dataset.load() MUST continue to accept unversioned artifacts (migration compatibility). Dataset.load() MUST reject unknown schema versions.
- Default behavior remains cache-first and resumable; `--refresh` discards cached raw responses and processed markers; `--reset` clears processed markers and rebuilds from cache without re-downloading; `--refresh` and `--reset` cannot be used together.
- Complete-game filtering preserved; only complete games stored/saved.
- Atomic JSON persistence preserved for cache and dataset.
- API is read-only; must not expose raw upstream cache content; last-known-good snapshot retained if served artifact becomes invalid.
- Local-only: generated data and API responses must not be committed; cache stays local and unexposed.
- Keep source-specific headers, timeouts, activity reporting, retryable status/decode rules, and RIMS-specific 429 policy.

## Review Focus

- **Cache-reset vs refresh semantics:** Refresh must clear both raw responses and processed markers; reset must only clear processed markers (and delete negative prefixes per existing behavior) without upstream requests; simultaneous flags rejected. Any regression causes incorrect re-fetching or stale data reuse.
- **Unversioned artifact migration:** `Dataset.load()` must accept datasets missing `schemaVersion` (treat as v1-compatible) and reject `schemaVersion != 1 and != None`. Coercion errors must produce clear validation errors consistent with current behavior.
- **Atomic persistence correctness:** Cache/dataset writes must use atomic temp+replace and fsync semantics to avoid corrupt files on interruption; corrupt cache must be quarantined as `.corrupt` with fresh start.
- **API reload and last-known-good:** On invalid replacement artifact, the served snapshot must remain the last valid one; on valid atomic replacement, new content must be served without restart. ETag must reflect current artifact state.
- **Transport retry behavior:** Non-retryable 4xx (except 429) must not retry; retryable errors (HTTP 429/5xx, OSError, JSON decode errors) must follow existing RIMS policy and activity reporting; cache-first behavior must remain intact.

---

## 1. Dependencies and contract models

**Files:**
- Modify: `pyproject.toml`
- Modify: `uv.lock` (regenerated via uv sync)
- Modify: `src/rugby_data/models.py`
- Modify: `src/rugby_data/dataset.py`
- Test: `tests/test_dataset_contract.py` (strengthen with Pydantic validation cases)
- Test: `tests/test_dataset_validation.py` (new - contract/JSON validation coverage as per 1.3)

**Interfaces:**
- Produces: Pydantic model classes `RosterEntry`, `Competitor`, `Game` (v2) with field aliases (camelCase in serialized form) and `ConfigDict/populate_by_name` or `AliasChoices`; dataset serialization using model dump with by_alias=True.
- Consumes: Existing `game_from_dict/game_to_dict` API surface used by dataset, server, builder (preserve behavior).

### 1.1 Add and lock dependencies

- [ ] **Step 1: Write the failing test**  
  No new behavioral test required; this is a dependency change. Add/update test stub expectations only if necessary. But verify clean baseline.
- [ ] **Step 2: Run tests to verify baseline**  
  Run: `uv run pytest tests/test_dataset_contract.py tests/test_server.py tests/test_fetch_entities.py tests/test_audit_remedies.py -v`  
  Expected: All pass (current state).
- [ ] **Step 3: Add dependencies to pyproject.toml**  
  Add FastAPI, Uvicorn, HTTPX, Tenacity, Typer, Pydantic v2. Update requires-python if needed (already >=3.12). Keep version bounds reasonable.
- [ ] **Step 4: Sync dependencies**  
  Run: `uv sync`  
  Expected: Dependencies resolved; `uv.lock` updated.
- [ ] **Step 5: Commit**  
  ```bash
  git add pyproject.toml uv.lock
  git commit -m "chore: add FastAPI/Uvicorn/HTTPX/Tenacity/Typer/Pydantic v2 deps"
  ```

### 1.2 Convert schema-v1 models and serialization to Pydantic

- [ ] **Step 1: Write the failing test**  
  Add to `tests/test_dataset_contract.py` (or new test) asserting Pydantic-backed models preserve roundtrip and aliases. For example: Game.model_validate then model_dump(by_alias=True) gives same structure.
- [ ] **Step 2: Run test to verify it fails**  
  Run: `uv run pytest tests/test_dataset_contract.py -v`  
  Expected: FAIL if new test added; otherwise proceed.
- [ ] **Step 3: Refactor models to Pydantic v2**  
  Modify `src/rugby_data/models.py` to use `BaseModel` with `Field(alias=...)` for camelCase (`playerId`, `jersey`, `teamId`, `home`, `score`, `roster`, `coachId`, `eventId`, `date`, `competitors`, `venueId`, `leagueId`). Set `model_config = ConfigDict(populate_by_name=True)`. Provide `is_complete()` methods. Keep dataclass-like behavior where needed; ensure serialization preserves camelCase. Maintain compatibility helpers `roster_from_dict`, `competitor_from_dict`, `game_from_dict`, `game_to_dict` using Pydantic validation (or `model_validate`).
- [ ] **Step 4: Update dataset to use Pydantic models**  
  Modify `src/rugby_data/dataset.py` so loading uses `game_from_dict` (which now validates via Pydantic) and saving uses `game_to_dict` (which dumps with aliases). Ensure `Dataset.load()` still accepts unversioned inputs and rejects unknown schema versions (schema check before Pydantic validation). Preserve all registries and locking semantics.
- [ ] **Step 5: Run tests to verify they pass**  
  Run: `uv run pytest tests/test_dataset_contract.py tests/test_server.py -v`  
  Expected: PASS. Existing behavior preserved.
- [ ] **Step 6: Commit**  
  ```bash
  git add src/rugby_data/models.py src/rugby_data/dataset.py tests/test_dataset_contract.py
  git commit -m "refactor: convert models/dataset to Pydantic v2 with camelCase aliases"
  ```

### 1.3 Add contract and JSON-schema validation tests

- [ ] **Step 1: Write the failing tests**  
  Create `tests/test_dataset_validation.py` with tests for: (a) complete-game filtering preserved (incomplete games dropped on merge/load as appropriate), (b) identifier preservation (eventId, teamId types preserved; source strings for event/player/coach/venue/league; team IDs numeric), (c) schema v1 structure on save, (d) unversioned load compatibility, (e) unknown schema rejected.
- [ ] **Step 2: Run tests to verify they fail**  
  Run: `uv run pytest tests/test_dataset_validation.py -v`  
  Expected: FAIL (new file).
- [ ] **Step 3: Verify implementation meets tests**  
  Ensure models/dataset already satisfy these (no code change if already passing). If not, adjust minimally.
- [ ] **Step 4: Run tests to verify they pass**  
  Run: `uv run pytest tests/test_dataset_validation.py -v`  
  Expected: PASS.
- [ ] **Step 5: Commit**  
  ```bash
  git add tests/test_dataset_validation.py
  git commit -m "test: add contract validation coverage for schema and identifiers"
  ```

---

## 2. Refresh and cache persistence

**Files:**
- Modify: `src/rugby_data/cache.py`
- Modify: `src/rugby_data/cli.py` (ensure refresh/reset semantics correct)
- Test: `tests/test_refresh_cache.py` (new) for 2.3

**Interfaces:**
- Preserves `ApiCache.clear()`, `reset_processed_to()`, `delete_prefix()`, `mark_processed()`, `is_processed()`, atomic save semantics.

### 2.1 Implement explicit refresh cache invalidation

- [ ] **Step 1: Write the failing test**  
  Add test verifying refresh behavior in CLI/build path: when refresh=True, cache cleared and processed markers cleared. Also verify reset+refresh rejected.
- [ ] **Step 2: Run test to verify it fails**  
  Run: `uv run pytest -v` focusing on new test.  
  Expected: FAIL if new test asserts behavior not present.
- [ ] **Step 3: Verify current implementation**  
  Current `build_dataset` already implements refresh: clears cache and sets empty dataset; reset clears processed and negative prefixes. Also CLI rejects both flags. Confirm no changes needed; if needed, make explicit.
- [ ] **Step 4: Run tests to verify they pass**  
  Run: `uv run pytest tests/test_audit_remedies.py -v` (has cache/reset/negatives behavior) plus new tests.  
  Expected: PASS.
- [ ] **Step 5: Commit**  
  ```bash
  git add src/rugby_data/cli.py
  git commit -m "chore: confirm refresh/reset semantics documented by tests"
  ```

### 2.2 Reuse atomic JSON persistence for cache checkpoints

- [ ] **Step 1: Write the failing test**  
  Test that cache save uses atomic writes (no partial file visible on interruption semantics). Can test by mocking replace to simulate failure? Or just assert file written atomically.
- [ ] **Step 2: Run test to verify it fails**  
  Run: `uv run pytest -v`  
  Expected: as appropriate.
- [ ] **Step 3: Refactor cache to use storage.atomic_write_json**  
  Modify `src/rugby_data/cache.py` to use `storage.atomic_write_json` instead of manual temp+rename+fsync (or ensure same behavior). Keep soft-write throttling and pending_writes logic; `save(force=True/False)` should still behave identically. Also preserve corrupt cache quarantine behavior.
- [ ] **Step 4: Run tests to verify they pass**  
  Run: `uv run pytest tests/test_audit_remedies.py tests/test_fetch_entities.py -v`  
  Expected: PASS (cache behavior unchanged).
- [ ] **Step 5: Commit**  
  ```bash
  git add src/rugby_data/cache.py
  git commit -m "refactor: use atomic_write_json for cache persistence"
  ```

### 2.3 Add deterministic refresh/cache compatibility coverage

- [ ] **Step 1: Write the failing tests**  
  Create `tests/test_refresh_cache.py`: (a) refresh clears raw and processed (rebuilds from upstream), (b) reset reuses cache without upstream calls, (c) refresh and reset together rejected, (d) cache-only reset doesn’t trigger downloads. Mock transport/fetches as needed.
- [ ] **Step 2: Run tests to verify they fail**  
  Run: `uv run pytest tests/test_refresh_cache.py -v`  
  Expected: FAIL.
- [ ] **Step 3: Implement to satisfy tests**  
  Adjust CLI/build logic if necessary (current logic should already satisfy).
- [ ] **Step 4: Run tests to verify they pass**  
  Run: `uv run pytest tests/test_refresh_cache.py -v`  
  Expected: PASS.
- [ ] **Step 5: Commit**  
  ```bash
  git add tests/test_refresh_cache.py
  git commit -m "test: add refresh/cache compatibility coverage"
  ```

---

## 3. Upstream transport

**Files:**
- Create: `src/rugby_data/http.py` (HTTPX client factory with Tenacity retries)
- Modify: `src/rugby_data/transport.py` (or replace internals to delegate to http.py while keeping same API: `CachedJsonTransport`, `ActivityTracker`)
- Modify: `src/rugby_data/api.py`, `src/rugby_data/rims_api.py` (if needed, minimal changes)
- Test: `tests/test_transport_mock.py` (new) per 3.3

**Interfaces:**
- Keep `CachedJsonTransport.get(url)`, `fetch(url)`, `ActivityTracker.snapshot()`, and the `describe`/retry policy hook. Preserve cache-first behavior, source headers, timeouts.

### 3.1 Replace urllib transport with reusable HTTPX clients

- [ ] **Step 1: Write the failing test**  
  Add test asserting transport still works with mocked HTTP responses; behavior unchanged.
- [ ] **Step 2: Run test to verify it fails**  
  Run: `uv run pytest -v`  
  Expected: as appropriate.
- [ ] **Step 3: Implement http layer**  
  Create `src/rugby_data/http.py` with a synchronous HTTPX client (or factory). Keep timeouts and headers as before.
- [ ] **Step 4: Refactor transport to use HTTPX**  
  Modify `src/rugby_data/transport.py`: use HTTPX for actual requests. Preserve `ActivityTracker` behavior. Cache-first: if in cache, return from cache; else record activity, fetch, store.
- [ ] **Step 5: Run tests to verify they pass**  
  Run: `uv run pytest tests/test_fetch_entities.py tests/test_audit_remedies.py -v`  
  Expected: PASS.
- [ ] **Step 6: Commit**  
  ```bash
  git add src/rugby_data/http.py src/rugby_data/transport.py
  git commit -m "refactor: migrate transport to HTTPX client"
  ```

### 3.2 Replace hand-written retry mechanics with Tenacity

- [ ] **Step 1: Write the failing test**  
  Add test asserting retry behavior on retryable errors (429, 5xx, decode errors, OSError). Ensure non-retryable 4xx except 429 do not retry.
- [ ] **Step 2: Run test to verify it fails**  
  Run: `uv run pytest -v`  
  Expected: FAIL if expecting Tenacity-backed retries.
- [ ] **Step 3: Integrate Tenacity**  
  Replace manual retry loop in transport with Tenacity (retry on retryable exceptions, wait strategy matching RIMS policy). Preserve RIMS-specific 429 delay behavior (can be handled via wait_func or retry condition). Keep logging of retry attempts.
- [ ] **Step 4: Run tests to verify they pass**  
  Run: `uv run pytest tests/test_fetch_entities.py -v`  
  Expected: PASS. Preserve existing retry semantics.
- [ ] **Step 5: Commit**  
  ```bash
  git add src/rugby_data/transport.py
  git commit -m "refactor: use Tenacity for retry policy"
  ```

### 3.3 Add mocked transport coverage

- [ ] **Step 1: Write the failing tests**  
  Create `tests/test_transport_mock.py` covering: cache hits (no fetch), success, retryable failures (429/5xx), terminal 4xx (non-retryable), invalid JSON.
- [ ] **Step 2: Run tests to verify they fail**  
  Run: `uv run pytest tests/test_transport_mock.py -v`  
  Expected: FAIL (new).
- [ ] **Step 3: Ensure transport satisfies mocks**  
  Adjust transport implementation if gaps found.
- [ ] **Step 4: Run tests to verify they pass**  
  Run: `uv run pytest tests/test_transport_mock.py -v`  
  Expected: PASS.
- [ ] **Step 5: Commit**  
  ```bash
  git add tests/test_transport_mock.py
  git commit -m "test: add mocked transport coverage"
  ```

---

## 4. API and CLI

**Files:**
- Create: `src/rugby_data/api_app.py` (FastAPI application factory)
- Modify: `src/rugby_data/server.py` (or replace with FastAPI-backed implementation while preserving behavior)
- Modify: `src/rugby_data/cli.py` (Typer commands)
- Modify: `tests/test_server.py` (rewrite to use FastAPI TestClient)
- Modify: `tests/test_cli*.py` if they exist (or add CLI tests using Typer runner) - check existing; may need to add CLI tests
- Test: `tests/test_cli.py` (new or rewritten) per 4.4

**Interfaces:**
- Preserve endpoints: `/dataset`, `/health`, `/games/{id}`, `/teams/{id}`, `/players/{id}`, `/venues/{id}`, `/leagues/{id}`, `/coaches/{id}`. Read-only; ETags; 304 on match; 404 for unknown/malformed; last-known-good on invalid replacement; missing dataset on startup fails.
- CLI preserves command names `dataset` and `serve` with same options/flags.

### 4.1 Replace manual HTTP server with FastAPI app and validated snapshot

- [ ] **Step 1: Write the failing test**  
  Extend server tests to also work with TestClient (behavior unchanged).
- [ ] **Step 2: Run test to verify it fails**  
  Run: `uv run pytest tests/test_server.py -v`  
  Expected: FAIL after refactor prep.
- [ ] **Step 3: Create FastAPI app**  
  Create `src/rugby_data/api_app.py` with application factory that loads dataset snapshot, validates (schema v1), serves artifacts, handles ETags, reloads on change, retains last-valid on invalid. Do not expose cache.
- [ ] **Step 4: Update server/CLI serve path**  
  Modify `src/rugby_data/server.py` to either wrap FastAPI with Uvicorn programmatically, or keep compatible interface. CLI serve currently instantiates `DatasetServer` and calls `serve_forever()`; preserve this API so existing code paths still work? Or update CLI to use Uvicorn. But keep same behavior and messages.
- [ ] **Step 5: Run tests to verify they pass**  
  Run: `uv run pytest tests/test_server.py -v`  
  Expected: PASS. Same endpoint behavior, ETags, reload semantics.
- [ ] **Step 6: Commit**  
  ```bash
  git add src/rugby_data/api_app.py src/rugby_data/server.py
  git commit -m "refactor: replace manual server with FastAPI app and validated snapshot"
  ```

### 4.2 Implement schema artifact, health, contract fragments with ETag/reload

- [ ] **Step 1: Write the failing test**  
  Add specific tests for all routes, conditional retrieval, malformed paths (return 404 JSON), read-only methods (405). Verify last-known-good behavior on invalid replacement.
- [ ] **Step 2: Run test to verify it fails**  
  Run: `uv run pytest tests/test_server.py -v`  
  Expected: FAIL if missing cases.
- [ ] **Step 3: Implement in FastAPI app**  
  Ensure routes: GET /dataset returns full schema v1 artifact; GET /health returns status/schemaVersion/generatedAt; fragment routes for games/teams/players/venues/leagues/coaches by identifier. ETag generation from artifact state; 304 on If-None-Match match. Reload detects atomic replacement; invalid replacement retains last valid.
- [ ] **Step 4: Run tests to verify they pass**  
  Run: `uv run pytest tests/test_server.py -v`  
  Expected: PASS.
- [ ] **Step 5: Commit**  
  ```bash
  git add src/rugby_data/api_app.py
  git commit -m "feat: implement full API routes with ETag and reload semantics"
  ```

### 4.3 Replace argparse with Typer commands

- [ ] **Step 1: Write the failing test**  
  Create or update CLI tests using Typer's CliRunner. Test dataset command flags (--output, --cache, --team, --source, --reset, --skip-failed, --refresh), serve flags, and reset+refresh conflict.
- [ ] **Step 2: Run test to verify it fails**  
  Run: `uv run pytest tests/test_cli.py -v 2>&1 | tail -20`  
  Expected: FAIL if new test.
- [ ] **Step 3: Refactor CLI to Typer**  
  Modify `src/rugby_data/cli.py`: use Typer for `app` with `dataset` and `serve` commands. Preserve all option names and behavior. Keep `build_dataset()` function as-is for programmatic use. Ensure error when reset+refresh together.
- [ ] **Step 4: Run tests to verify they pass**  
  Run: `uv run pytest tests/test_cli.py -v`  
  Expected: PASS. Existing behavior preserved.
- [ ] **Step 5: Commit**  
  ```bash
  git add src/rugby_data/cli.py tests/test_cli.py
  git commit -m "refactor: migrate CLI to Typer"
  ```

### 4.4 Rewrite API and CLI tests

- [ ] **Step 1: Write the failing tests**  
  Rewrite `tests/test_server.py` to use FastAPI TestClient from `api_app` (or equivalent). Create `tests/test_cli.py` with Typer CliRunner tests for all command variants. Ensure all existing behaviors covered.
- [ ] **Step 2: Run tests to verify they fail**  
  Run: `uv run pytest tests/test_server.py tests/test_cli.py -v`  
  Expected: FAIL during transition.
- [ ] **Step 3: Implement to satisfy tests**  
  Make app/CLI pass all test cases.
- [ ] **Step 4: Run tests to verify they pass**  
  Run: `uv run pytest tests/test_server.py tests/test_cli.py -v`  
  Expected: PASS.
- [ ] **Step 5: Commit**  
  ```bash
  git add tests/test_server.py tests/test_cli.py
  git commit -m "test: rewrite API and CLI tests for FastAPI and Typer"
  ```

---

## 5. Documentation and verification

**Files:**
- Modify: `README.md`, `AGENTS.md`, `justfile`
- Clean up: remove superseded custom plumbing (e.g. old server code paths if fully replaced)
- Test: run full verification suite

### 5.1 Update docs and recipes

- [ ] **Step 1: Write the failing test**  
  No test change required; verify docs/recipes accurate.
- [ ] **Step 2: Update README**  
  Document refresh behavior and local API (if API becomes part of CLI surface). Preserve existing instructions.
- [ ] **Step 3: Update AGENTS.md**  
  Update with any relevant notes about new tools if needed; preserve repo rules.
- [ ] **Step 4: Update justfile**  
  Ensure recipes still work (`just setup`, `just dataset`, `just check`, `just test`, `just lint`). Add any new recipes if needed for API? Preserve existing.
- [ ] **Step 5: Commit**  
  ```bash
  git add README.md AGENTS.md justfile
  git commit -m "docs: update README, AGENTS, justfile for refresh and API"
  ```

### 5.2 Remove superseded custom plumbing

- [ ] **Step 1: Identify obsolete code**  
  Review for code made redundant: custom HTTP server implementation details no longer needed; old transport code paths; unused imports. Remove superseded custom plumbing and unrelated formatter-only diff noise.
- [ ] **Step 2: Remove safely**  
  Delete/trim code only after tests pass; ensure no loss of behavior.
- [ ] **Step 3: Run tests**  
  Run: `uv run pytest -v`  
  Expected: PASS.
- [ ] **Step 4: Commit**  
  ```bash
  git add -A
  git commit -m "refactor: remove superseded plumbing"
  ```

### 5.3 Run full verification

- [ ] **Step 1: Sync dependencies**  
  Run: `uv sync`  
  Expected: up to date.
- [ ] **Step 2: Lint**  
  Run: `uv run ruff check .`  
  Expected: no lint errors.
- [ ] **Step 3: Type/check**  
  Run: `uv run ty check` (or `just check`)  
  Expected: passes.
- [ ] **Step 4: Test**  
  Run: `uv run pytest -v`  
  Expected: all tests pass.
- [ ] **Step 5: Verify generated data/cache untracked**  
  Run: `git status --short -- data/ .cache/` and check for untracked files. Also confirm no generated dataset or API cache committed.  
  Expected: only intentional untracked files (or clean).
- [ ] **Step 6: Commit final verification marker**  
  ```bash
  git commit --allow-empty -m "verify: all checks pass after modernization"
  ```
---
