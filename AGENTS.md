# Rugby Composition Predictor

This repository builds a cached dataset of international rugby union matches from
World Rugby RIMS and ESPN, then renders a temporal player/coaching co-occurrence
graph in a Svelte browser application.

## Working Rules

- Use CodeGraph to understand symbols and call paths before editing source.
- Keep changes scoped to the request. Prefer existing utilities and dependencies.
- Update the relevant existing documentation when a change affects behavior, workflows, interfaces, or data contracts.
- Do not commit, amend, or push unless the user explicitly asks.
- Never commit secrets, `.env` files, API responses, cache data, or local server state.
- Do not hand-edit generated data under `data/`; regenerate it with `just dataset`.
- Do not run destructive data-cache operations, releases, or dependency upgrades without explicit approval.

## Stack And Layout

- Python 3.12+: ingestion CLI and dataset model in `src/rugby_composition_predictor/`.
- Svelte 5, TypeScript, Vite, Tailwind 4, and daisyUI: browser viewer in `web/`.
- Graphology, Sigma, and ForceAtlas2: browser graph construction and layout.
- `data/dataset.json`: generated viewer input. It is ignored by Git and fetched at runtime from `/data/dataset.json`.
- `tests/`: cache-backed Python diagnostic only; it is not a hermetic test suite.
- `web/tests/`: Playwright temporal, integration, acceptance, and performance coverage.
- `docs/graph_architecture.md` and `docs/test_strategy.md`: deeper graph and testing references.

## Commands

Run project tasks from the repository root through `just`. Do not use raw `npm`,
`uv`, `pip`, `npx`, or `cd web && ...` when a recipe exists.

| Task | Command |
| --- | --- |
| Install Python and web dependencies | `just setup` |
| Build or resume the dataset | `just dataset` |
| Re-derive using cached API responses | `just dataset --reset` |
| Start the development server | `just dev-start` |
| Check dev-server state or logs | `just dev-status`, `just dev-logs` |
| Stop the development server | `just dev-stop` |
| Production web build | `just web` |
| Build and preview the viewer on port 8787 | `just serve` |
| Python type and bytecode checks | `just check-python` |
| Python lint with auto-fix | `just lint-python` |
| TypeScript and Svelte checks | `just check-web` |
| Web lint with auto-fix | `just lint-web` |
| Playwright browser suite | `just test-web [args]` |

- `just lint-python` and `just lint-web` intentionally modify files. Inspect their diff before retaining changes.
- Run `just dev-start` before `just test-web`; the Playwright suite uses the running development server.
- `just web` runs a clean web dependency install before building. Use it for a production-build check, not for routine iteration.
- `just dataset` is resumable and cached. Use `--skip-failed` only when intentionally excluding previously terminal failures.

## Data Contract

- RIMS/Opta numeric IDs are canonical for teams, players, and coaches.
- Keep only complete games: two competitors, non-empty rosters, and both scores.
- Jersey numbers 1-15 are starters; 16-23 are bench players.
- The dataset pipeline is `cli.py` -> `DatasetBuilder` -> RIMS/ESPN clients and `ApiCache` -> `Dataset.save()`.
- The viewer treats `dataset.json` as its source of truth. Do not reintroduce a separate graph export without an explicit design change.
- Preserve cache semantics: `--reset` re-derives from cached responses; deleting `data/api_cache.json` forces API downloads.

## Code Conventions

### Python

- Match the existing Pydantic models and `Dataset` merge/save boundaries rather than passing untyped API dictionaries across modules.
- Use Python 3.12 typing and Ruff formatting: 88-character lines, double quotes.
- Preserve the builder's incremental-save, processed-marker, and negative-cache behavior when changing ingestion.
- Add fixture-based tests for deterministic parsing, normalization, serialization, or cache behavior when practical. Do not promote the cache-backed diagnostic to a CI gate.

### Web

- Use Svelte 5 runes and the existing component/data-flow patterns.
- Keep graph construction in `web/src/graph/`; keep shared domain types in `web/src/types.ts`.
- Preserve temporal graph invariants: immutable dataset input, sorted match stream, reversible deltas, and one persistent layout worker.
- Use Tailwind utilities for layout and spacing and daisyUI classes/variants for controls. Avoid custom `<style>` blocks.
- Use `font-mono` for numeric or technical displays. Test UI changes at desktop and narrow mobile widths.

## Verification

Run the narrowest relevant checks while developing, then run the applicable completion checks.

| Change | Required checks before completion |
| --- | --- |
| Python source | `just check-python` |
| Python lint-affecting change | `just lint-python`, then inspect the diff |
| Svelte or TypeScript source | `just check-web` |
| Web lint-affecting change | `just lint-web`, then inspect the diff |
| Temporal graph, interaction, or browser behavior | `just dev-start`, then `just test-web` |
| Web production behavior or dependencies | `just web` |
| User-visible UI behavior | Verify the running viewer at desktop and mobile widths |

If a required check cannot run, report the exact command and reason. Do not claim success without stating the verification performed.

## Git

- Use `just commit <type> <summary> [body]` only when a commit is requested.
- Valid commit types are `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `style`, `build`, and `revert`.
