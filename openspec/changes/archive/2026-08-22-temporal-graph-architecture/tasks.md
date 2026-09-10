## 1. Python Cleanup (remove graph.json pipeline)

- [x] 1.1 Remove `CoOccurrenceGraph` class from `src/rugby_composition_predictor/graph.py`
- [x] 1.2 Remove the `graph` subcommand and `build_graph` function from `cli.py`
- [x] 1.3 Update `AGENTS.md` commands table (drop `just graph`/`build` graph step; web loads dataset.json)
- [x] 1.4 Keep `dataset.json` schema stable; confirm it carries games/competitors/rosters/dates/coach IDs

## 2. Web Temporal Engine

- [x] 2.1 Add types `Match`, `Delta`, `PairKey` to `web/src/temporal/types.ts`
- [x] 2.2 Implement `MatchTimeline.ts`: load `dataset.json`, flatten games→matches (per-team), integer timestamps, sort by time
- [x] 2.3 Implement `TemporalAccumulator.ts`: `playerCounts`/`pairCounts` Maps, `applyMatch(match, dir)`, `seek(targetTime)` returning a batched `Delta`
- [x] 2.4 Add `console.assert(newCount >= 0)` guard and periodic invariant check (graph matchCount === pairCounts)
- [x] 2.5 Write unit tests: forward/backward reversibility, exact-counter equality, same-day batching, delta-only-changed-topology

## 3. Active Graph Projection

- [x] 3.1 Create `web/src/graph/ActiveGraph.ts` wrapping `UndirectedGraph`
- [x] 3.2 Implement `applyDelta(delta)`: add nodes, add/update edges, then remove edges/nodes so a backward same-day batch cannot recreate a zero-count edge (`temporal-graph.spec.ts` seek sequence)
- [x] 3.3 Implement position cache (store x/y on remove; reuse on add); teammate-centroid + jitter seed for new nodes
- [x] 3.4 Set edge attributes `matchCount`, `weight = Math.sqrt(matchCount)`, `size = 0.5 + log2(matchCount+1)`
- [x] 3.5 Make the temporal projection the only production web graph path; no static `buildGraph` route remains

## 4. Persistent Layout

- [x] 4.1 Add `PersistentForceAtlas2`: retain one FA2 Worker and reload matrices at its message boundary after batched topology changes, without stop/start or replacement (`temporal-graph.spec.ts`, browser topology scrub)
- [x] 4.2 Configure Barnes-Hut + weighted mode (`barnesHutOptimize`, `edgeWeightInfluence`, `gravity`, `scalingRatio`, `slowDown`)
- [x] 4.3 Expose `kill()` only on `TemporalGraph` teardown; never restart on timeline change
- [x] 4.4 Verify add/remove events retain worker identity and reload topology without a graph rebuild (`temporal-graph.spec.ts` message-boundary adapter test and `temporal-ui.spec.ts` real-worker scrub)

## 5. Timeline Controller & UI

- [x] 5.1 Create `web/src/TimelineController.ts` owning timeline + accumulator + ActiveGraph + FA2 + Sigma
- [x] 5.2 Implement RAF loop: compute targetTime from playback state/speed, `seek`, `applyDelta`, let renderer react
- [x] 5.3 Add timeline UI controls (play/pause/scrub/speed) in `App.svelte` / `Timeline.svelte` calling the controller
- [x] 5.4 Wire initial load position (constructor, `VITE_TIMELINE_INITIAL_POSITION`, and UI support empty dateMin or full dateMax; unit and browser tests cover both)
- [x] 5.5 Temporal cursor owns the application's time window; static window logic is removed from the production route

## 6. Filter Overlays

- [x] 6.1 Move temporal live `matchCount` filtering into shared `reducers.ts` (`createTemporalEdgeReducer`)
- [x] 6.2 Add match/partner interaction overlay parity through shared reducers without topology rebuild (`temporal-ui.spec.ts`)
- [x] 6.3 Accumulator records live per-edge win rate and latest contribution; reducer colors win rate or recency as `f(latest,currentTime)`
- [x] 6.4 Validate team, minimum-match, match, and partner reducer overlays side by side with their legacy semantics in deterministic browser fixtures (`temporal-ui.spec.ts`)

## 7. Validation & Rollout

- [x] 7.1 Temporal is the only production viewer route; it requests `dataset.json` and never `graph.json` (`temporal-ui.spec.ts`)
- [x] 7.2 Compare dateMax active topology and exact per-edge weights/dates against the committed legacy `graph.json` fixture using its declared dataset path (`temporal-graph.spec.ts`)
- [x] 7.3 Measure a 3,483-node, 90k+-edge temporal projection in CI with a 20s projection-seek budget (`production-measurement.spec.ts`)
- [x] 7.4 Remove the flagged static web path and `VITE_ENABLE_LEGACY_STATIC_GRAPH`; the former static entry, graph component, and controller are deleted
- [x] 7.5 Run `just check-web` / `just lint-web`; update `README` and `AGENTS.md`
