# Execution Ledger: modernize-service-foundations

## Task 1: Public API Models → Pydantic v2
✅ Completed: Converted models to Pydantic v2 while preserving camelCase serialization, positional constructors, helper APIs, and existing filtering behavior. Added dataset validation tests.

## Task 2: Cache Synchronization & Atomic Persistence
✅ Completed: Implemented shared atomic JSON persistence with parent-directory fsync after replacement. Added deterministic refresh/reset/cache tests. Verified cache behavior preservation.

## Task 3: HTTPX + Tenacity Transport Layer
✅ Completed: Migrated from urllib to HTTPX + Tenacity. Fixed transport defects (HTTPX retry classification, RIMS 429 minimum retry delay, client lifecycle/closure). Added mocked transport tests.

## Task 4: API & CLI Modernization
✅ Completed:
- **4.1/4.2 FastAPI API Migration**: Created `api_app.py` with application factory `create_app(path: Path) → FastAPI`. Implemented:
  - Routes: `/dataset`, `/health`, `/games/{id}`, `/teams/{id}`, `/players/{id}`, `/venues/{id}`, `/leagues/{id}`, `/coaches/{id}`
  - ETag/If-None-Match 304 responses
  - JSON 404 for unknown fragments
  - Hot reload with last-valid snapshot retention on invalid replacement
  - Startup failure on missing/unreadable/unsupported schema
- **4.3/4.4 Typer CLI Migration**: Refactored `cli.py` to use Typer while preserving all existing commands and flags:
  - `dataset` command with `--output`, `--cache`, `--team`, `--source`, `--reset`, `--skip-failed`, `--refresh`
  - `serve` command with `--dataset`, `--host`, `--port`
  - Proper error handling for conflicting flags
  - Resource cleanup via `builder.close()` in finally block
- **Tests**: Rewrote `tests/test_server.py` to use FastAPI TestClient. Added `tests/test_cli.py` for Typer CLI testing.

## Tooling & Documentation
✅ Completed:
- Added `.pre-commit-config.yaml` with:
  - Pre-commit hooks (trailing whitespace, end-of-file fixer, YAML/TOML checks, merge conflict detection, debug statements)
  - Ruff pre-commit (with `--fix`)
  - Conventional commit message hook (feat, fix, docs, refactor, test, chore, perf, ci, revert)
- Updated `justfile`:
  - Added `just install-hooks` (installs pre-commit and commit-msg hooks)
  - Added `just hooks` (runs all hooks manually)
  - Added `just commit <args>` (conventional commit wrapper)
  - Changed test command to use `pytest`
  - Added format check to lint command
- Updated `README.md` and `AGENTS.md` with tooling guidance:
  - Repowise for output distillation
  - CCC (cocoindex-code) for semantic code search
  - Codegraph for symbol exploration
  - Superpowers for skill-driven development
  - Conventional Commits and pre-commit setup instructions

## Verification
- All tests pass: 41 passed, 1 warning (Starlette deprecation - expected)
- Lint and type checks pass
- Pre-commit hooks run successfully
- Git history shows clean, atomic commits following Conventional Commits
