## Objective
- Match-view behaviors: graph rebuild on enter, team-name↔node hover sync, exact original graph+camera restore on close. Plus: drop domestic teams + fix team colours (config/ID mismatch, done). Viewport autosize was test-emulation artifact (cleared).

## Important Details
- graph.py stores RIMS team ids (39=SA) but colour config keyed by ESPN ids (5=SA) — root cause of wrong colours + domestic teams leaking in. Fixed by RIMS→ESPN map + INTERNATIONAL_TEAM_IDS filter (graph.py).
- Match rebuild confirmed working: enter → 1163→48 nodes (match subset); exit → restorePreMatch restores cached full graph + camera (no relayout).
- Node hover now drives BOTH team-name highlight (original ask) AND the matching roster-row highlight (the "instead of players" fix).
- `python -m rugby_composition_predictor.graph` CLI write path broken (sys.modules warning) — regen done via direct `CoOccurrenceGraph.build_dict()` API.

## Work State
### Completed
- All 3 match behaviors: rebuild on enter/exit, team-name↔node hover, restore original graph+camera. Verified in browser (1163→48→1163; `[hoverNode] 48044 true`).
- Node hover → roster row: `enterNode` now emits `onNodeHover(node)` unconditionally; MatchHud highlights row via `hoveredPlayerId`.
- Roster row hover → node: new `GraphController.hoverNode()` + `Graph.svelte` export + `MatchHud` `onPlayerHover`/`onmouseenter`.
- `graph.py` international filter + RIMS→ESPN colour mapping. `data/graph.json` regenerated (37 intl teams, 3669 players, 902 games).
- `svelte-check` 0 errors (1 pre-existing tsconfig warning).

### Active
- (none)

### Blocked
- `python -m rugby_composition_predictor.graph` CLI write path broken — use API call instead.

## Next Move
1. (optional) Fix `graph.py` `__main__` so the CLI writes output again.
2. (none)

## Relevant Files
- `web/src/GraphController.ts` — `hoverNode`, `enterNode` emits `onNodeHover` always, `refreshLayout`/`restorePreMatch`.
- `web/src/Graph.svelte` — exports `hoverNode`; match effect → `refreshLayout`.
- `web/src/App.svelte` — `onPlayerHover`, `hoveredTeammate`→`hoveredPlayerId`, match wiring.
- `web/src/MatchHud.svelte` — `onPlayerHover`/`hoveredPlayerId`, row `mouseenter` + `.player-hover`.
- `web/src/app.css` — `.player-hover`, `.team-hover`.
- `src/rugby_composition_predictor/graph.py` — international filter + RIMS→ESPN colour mapping.
- `src/rugby_composition_predictor/config.py` — `HOME_KIT_COLOURS`/`INTERNATIONAL_TEAM_IDS`/`RIMS_TEAM_IDS`.
- `data/graph.json` — regenerated (37 intl teams, 3669 players, 902 games).
