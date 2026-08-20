# Rugby Composition Predictor — Agent Guide

## Project Overview
Builds dataset of international rugby union matches from ESPN CORE API + World Rugby RIMS API, derives player co-occurrence graph, visualises in browser (Svelte + sigma.js).

**Data flow:** ESPN/RIMS APIs → `dataset.json` → `graph.json` → web viewer

## Commands (via `just`)

| Command | Description |
|---------|-------------|
| `just setup` | Install deps (uv sync) |
| `just dataset` | Build `data/dataset.json` (resumable, cached) |
| `just graph` | Build `data/graph.json` from dataset |
| `just build` | Run both dataset + graph |
| `just web` | Build Svelte viewer → `dist/` |
| `just serve` | Build + preview on `localhost:8787` |
| `just dev-start/stop/restart/status/logs/follow` | Dev server management |
| `just check-python` | Type check + compile Python |
| `just lint-python` | Ruff lint + fix |
| `just check-web` | TypeScript + svelte-check |
| `just lint-web` | ESLint + fix |
| `just commit <type> <summary> [body]` | Conventional commit |

## Python Package (`src/rugby_composition_predictor/`)

**Entry point:** `rugby_composition_predictor` (via `uv run` or `.venv/bin/`)

**Subcommands:**
- `dataset [--team ID] [--source rims-first|rims|espn] [--reset] [--skip-failed]`
- `graph [--input dataset.json] [--output graph.json]`

**Key modules:**
- `cli.py` — CLI entry points
- `builder.py` — DatasetBuilder (orchestrates fetch/parse/merge)
- `api.py` — EspnApi (ESPN CORE + site.web API)
- `rims_api.py` — RimsApi (World Rugby RIMS)
- `cache.py` — ApiCache (JSON file, tracks processed events)
- `dataset.py` — Dataset model (load/save JSON)
- `graph.py` — CoOccurrenceGraph (builds player/coach edges)
- `config.py` — Constants: API bases, team IDs, paths, team colors
- `models.py` — Pydantic models for API responses
- `storage.py` — LocalStorage helpers for web

## Web App (`web/`)

**Stack:** Svelte 5 + Vite + TypeScript + Tailwind 4 + daisyUI
**Graph:** sigma.js v3 + graphology + ForceAtlas2 (web worker)

**Commands:**
- `npm run dev` — Dev server (port 5173)
- `npm run build` — Production build → `dist/`
- `npm run preview` — Serve `dist/` on port 8787
- `npm run typecheck` — `tsc --noEmit && svelte-check`
- `npm run lint` / `lint:fix` — ESLint

**Key files:**
- `web/src/lib.ts` — Main graph logic, parsing, filtering
- `web/src/types.ts` — Shared TypeScript interfaces
- `web/src/graph/positions.ts` — localStorage position persistence
- `web/src/components/` — Svelte components (GraphView, Controls, etc.)

**CSS conventions:**
- Use **Tailwind utility classes** for all layout and spacing
- Use **daisyUI component classes** for UI elements: `btn`, `badge`, `input`, `range`, `checkbox`, `tabs`, `collapse`, `stat`, `table`, `loading`, etc.
- Prefer `daisyUI` variants over custom CSS: `btn-primary`, `btn-ghost`, `btn-sm`, `badge-xs`, `input-bordered`, `range-sm`, `checkbox-xs`, `tab-active`, `collapse-plus`, etc.
- Avoid custom `<style>` blocks — use Tailwind + daisyUI only
- Use `font-mono` for numeric/technical displays

## Data Model

**`data/dataset.json`:**
```json
{
  "games": [{ "eventId", "date", "venueId", "leagueId", "competitors": [{ "teamId", "home", "score", "coachId", "roster": [{ "playerId", "jersey" }]}]}],
  "teams": { "id": "name" },
  "players": { "id": "name" },
  "venues": { "id": { "name", "city", "country" }},
  "leagues": { "key": { "name", "abbreviation" }},
  "coaches": { "id": "name" }
}
```

- IDs use **RIMS/Opta namespace** (numeric for teams/players/coaches)
- Only complete games kept (both competitors, non-empty rosters, both scores)
- Jerseys 1-15 = starters, 16-23 = bench

**`data/graph.json`:** Co-occurrence graph (nodes=players/coaches, edges=shared matches, weight=count)

## APIs Used

| API | Base URL | Purpose |
|-----|----------|---------|
| ESPN CORE | `https://sports.core.api.espn.com/v2/sports/rugby` | Team events, summaries |
| ESPN site.web | `https://site.web.api.espn.com/apis/site/v2/sports/rugby` | Lineups/rosters (inline in summary) |
| World Rugby RIMS | `https://api.wr-rims-prod.pulselive.com/rugby/v3` | Primary datasource (rosters, matches) |

## Development Notes

- Dev server runs on **port 5173** (Vite), preview on **port 8787**
- Cache at `data/api_cache.json` — raw API responses, keyed by URL
- `--reset` clears processed markers, re-derives from cache (no re-download)
- Delete `data/api_cache.json` to force full re-download
- `INTERNATIONAL_TEAM_IDS` in `config.py` — all national team IDs

## Tools to Use

 - **cocoindex-code** / **codegraph** — search/understand codebase
 - **chrome-devtools** — debug web app (port 5173 or 8787)
 - **just** — all project commands
 - **uv** — Python package management

## Agent configuration (opencode)

Agent behaviour for opencode is configured in `opencode.json` at the repo
root (safe to commit). It:

- ignores caches/build dirs in the file watcher (`node_modules/`, `dist/`,
  `.venv/`, `.codegraph/`, `.cocoindex_code/`, `data/api_cache.json`,
  `test-results/`) to cut change-notification noise;
- prunes old tool output during context compaction to keep long sessions
  within token limits;
- registers slash commands `/check`, `/lint`, `/build`, `/serve` for the
  common verify/build loops.

When editing this repo, prefer the `just` commands above and the code-intel
tools (codegraph for structure, chrome-devtools for the running viewer), and
run `just check-python` / `just check-web` after changes.