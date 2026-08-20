# Tasks

## 1. Filter model ripple (min-only)

- [x] 1.1 `types.ts`: change `FilterSet` `{minW,maxW,minD,maxD}` → `{minW,minD}` (interface `Filters`: minW, minD, dateStart, dateEnd, showCoaches)
- [x] 1.2 `lib.ts`: update `visibleSubset` signature + filter logic `{minW,minD}`; update subset cache key string
- [x] 1.3 `App.svelte`: replace `maxW`/`maxD`/`maxWCap` state with derived max weight (from `links`) + `graph.maxGlobalDeg`; update `view` derived, filter `$effect`, `resetView`, and `<Controls>`/`<Graph>` props
- [x] 1.4 `Graph.svelte`: change `minW/maxW/minD/maxD` props → `minW/minD`; update `currentFilters` rebuild key
- [x] 1.5 `Controls.svelte.d.ts`: align props (minW, minD, maxWeight, maxDeg, no date props, no maxW/maxD)

## 2. Unified search

- [x] 2.1 Create `web/src/UnifiedSearch.svelte`: one `input` + dropdown menu, grouped Players/Matches/Teams (group headers, per-kind caps), empty-query defaults (recent matches, top players by apps), "no results" empty state, `selectedId` input sync
- [x] 2.2 `App.svelte`: remove `<Search>`/`<MatchSearch>`; mount `<UnifiedSearch>` with `onPickPlayer`→`onGraphSelect`, `onPickMatch`→`onMatchClick`, `onPickTeam`→`zoomToTeam`
- [x] 2.3 Delete `web/src/Search.svelte`, `web/src/MatchSearch.svelte`; remove their declarations from `web/src/types.d.ts`

## 3. Filter bar rewrite

- [x] 3.1 Rewrite `Controls.svelte`: min shared-matches + min degree native `range` sliders (draft value, commit on change); View dropdown (node colour `select`, edge colour `select`, edge alpha `range`, coaches/metaballs `checkbox` combos); no date, no team zoom; snippets shared by desktop header + mobile bottom sheet (FAB `md:hidden`, Tailwind translate sheet + backdrop); zero custom CSS classes

## 4. CSS + cleanup

- [x] 4.1 `app.css`: delete `.control`, `.dual`, `.range-row`, `.endval`, custom `.btn`, `.mobile-drawer*`, `#search`/`#search-results`, `#team-zoom`/`#team-results`; keep canvas/cluster/edge-tip/HUD rules
- [x] 4.2 Migrate dead utilities in touched files (`App.svelte`, `Search`-adjacent): `text-muted-foreground` → `text-base-content/60`, `bg-base-50`/`bg-base-50/50` → `bg-base-200` (residual `text-muted-foreground`/`bg-base-50` in Hud.svelte, MatchHud.svelte, EdgeHud.svelte — out of scope: HUD restyle deferred)
- [x] 4.3 Delete `Controls.svelte.bak`, `App.svelte.bak`, `Timeline.svelte.bak`

## 5. Verification

- [x] 5.1 `just check-web` passes (tsc + svelte-check)
- [x] 5.2 `just lint-web` passes
- [x] 5.3 `just web` builds
- [x] 5.4 Dev-server DOM check: desktop toolbar + filter strip (sliders, view, search), mobile bottom sheet, player/match/team pick flows; grep shows no `.control|.dual|mobile-drawer` anywhere and no `text-muted-foreground|bg-base-50` outside out-of-scope HUD files
