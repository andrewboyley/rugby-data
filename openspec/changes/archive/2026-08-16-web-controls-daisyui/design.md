# Design

## Context

Current state (see proposal.md — Why): web viewer has Tailwind 4 + daisyUI 5 installed but ~80% hand-rolled CSS; `Controls.svelte` (548 lines) duplicates filter markup three times and builds custom dual-thumb sliders; filter model is Lo/Hi pairs (`minW/maxW/minD/maxD`) threaded through `types.ts` → `lib.ts` → `App.svelte` → `Graph.svelte`; three separate search surfaces exist. Graph-viz research (netwulf, MiRA, Cytoscape, Graphistry; Smashing/UXmatters) converges on min-threshold sliders with distribution feedback; header stats already provide live global node/edge counts.

## Goals / Non-Goals

**Goals**
- daisyUI/Tailwind-only filter bar with native `input.range` sliders (no custom slider CSS)
- Min-only filter model end-to-end
- Unified search replacing player/match/team-zoom surfaces
- Remove dead custom CSS + stray `.bak` files

**Non-Goals**
- Histogram-backed sliders, preset chips, per-slider live counts (header stat suffices)
- Timeline / HUD component restyles, full app.css purge
- Search result ranking beyond current `searchGames`/apps logic

## Decisions

**D1 — Native `input.range` min sliders over dual-thumb.** Research: graph tools filter by "keep connections above strength X"; e-commerce Lo/Hi bands overconstrain without distribution info. One slider per dimension, draft value commits to graph on `change` (release) — preserves existing "no rebuild per tick" behavior. Alternative rejected: custom dual-thumb (replicates current implementation, against "native" goal).

**D2 — Min-only ripple.** `FilterSet {minW, maxW, minD, maxD}` → `{minW, minD}`; `visibleSubset` + cache key drop max fields; `App.svelte` state drops `maxW/maxD/maxWCap` (max weight derived from `graph.links` for slider bound); `Graph.svelte` rebuild-key string drops max fields. Mechanical, verified by existing typecheck.

**D3 — View dropdown (F2) + bottom sheet (F4) via Svelte snippets.** Filters + View defined once as `{#snippet}`s, rendered into desktop header and mobile sheet — kills 3× duplication and `open`/`advancedVisible` state machines. Mobile sheet: FAB (`md:hidden`) + `fixed inset-x-0 bottom-0` panel toggled with Tailwind translate classes + backdrop.

**D4 — UnifiedSearch reuses `searchGames` + existing Search rankers.** Single component with one query string; group sections pulled via `menu-title`; per-kind caps (matches 8, players 8, teams 6). Callbacks `onPickPlayer` → `onGraphSelect`, `onPickMatch` → `onMatchClick`, `onPickTeam` → `zoomToTeam`. Selected player syncs input via `selectedId` prop (existing Search behavior).

**D5 — app.css surgery, not rewrite.** Delete only rules orphaned by this change (`.control`, `.dual`, `.range-row`, `.endval`, custom `.btn`, `.mobile-drawer*`, `#search*`, `#team-zoom`, `#team-results`) + dead utilities in touched components (`text-muted-foreground` → `text-base-content/60`, `bg-base-50(/50)` → `bg-base-200`). Rest of HUD/Timeline CSS untouched this pass. `.btn` custom rule is unlayered and currently overrides daisyUI — deleting it restores daisyUI button styling everywhere.

## Risks / Trade-offs

- **Behavior change: max-band filtering removed** → Intentional per research; users wanting bands get the filter via histogram pass later. Reset restores "any".
- **Slider-bounds derivation** (max weight = max `links[].w`, max degree = `maxGlobalDeg`) → Computed once at parse in `App.svelte`, passed as props; no live recompute.
- **Unified search perf** — `searchGames` is O(games) per keystroke → Existing cap (30 hits) + debounce-free current behavior kept; games count is small (dataset ~hundreds).
- **Custom `.btn` removal changes visual** → Desired: daisyUI buttons render for the first time correctly.
- **Preserve JS selectors** — `#panels`, `#hud`, `#edge-hud`, `#match-hud`, `.search-wrap` guard, `.graph-host` → IDs/classes kept on restyled elements.

## Migration Plan

- Single-pass change; apply order: (1) filter model ripple, (2) UnifiedSearch, (3) Controls rewrite, (4) app.css + dead-file cleanup, (5) verify (`just check-web`, `just lint-web`, `just web`, dev-server screenshot). Rollback: revert single commit (change is self-contained to `web/`).

## Open Questions

- None blocking; per-slider histogram/count UX deferred by design.