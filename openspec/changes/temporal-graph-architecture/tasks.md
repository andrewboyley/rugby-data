## 1. Python Cleanup (remove graph.json pipeline)

- [ ] 1.1 Remove `CoOccurrenceGraph` class from `src/rugby_composition_predictor/graph.py`
- [ ] 1.2 Remove the `graph` subcommand and `build_graph` function from `cli.py`
- [ ] 1.3 Update `AGENTS.md` commands table (drop `just graph`/`build` graph step; web loads dataset.json)
- [ ] 1.4 Keep `dataset.json` schema stable; confirm it carries games/competitors/rosters/dates/coach IDs

## 2. Web Temporal Engine

- [ ] 2.1 Add types `Match`, `Delta`, `PairKey` to `web/src/temporal/types.ts`
- [ ] 2.2 Implement `MatchTimeline.ts`: load `dataset.json`, flatten games→matches (per-team), integer timestamps, sort by time
- [ ] 2.3 Implement `TemporalAccumulator.ts`: `playerCounts`/`pairCounts` Maps, `applyMatch(match, dir)`, `seek(targetTime)` returning a batched `Delta`
- [ ] 2.4 Add `console.assert(newCount >= 0)` guard and periodic invariant check (graph matchCount === pairCounts)
- [ ] 2.5 Write unit tests: forward/backward reversibility, exact-counter equality, same-day batching, delta-only-changed-topology

## 3. Active Graph Projection

- [ ] 3.1 Create `web/src/graph/ActiveGraph.ts` wrapping `UndirectedGraph`
- [ ] 3.2 Implement `applyDelta(delta)`: remove edges/nodes first, then add seeded nodes, then add/update edges
- [ ] 3.3 Implement position cache (store x/y on remove; reuse on add); teammate-centroid + jitter seed for new nodes
- [ ] 3.4 Set edge attributes `matchCount`, `weight = Math.sqrt(matchCount)`, `size = 0.5 + log2(matchCount+1)`
- [ ] 3.5 Remove legacy `buildGraph` in `build-graph.ts` (or gate behind flag) once ActiveGraph is wired

## 4. Persistent Layout

- [ ] 4.1 Refactor `web/src/graph/layout.ts`: single `FA2Layout`, `start()` once, remove settlement/auto-stop
- [ ] 4.2 Configure Barnes-Hut + weighted mode (`barnesHutOptimize`, `edgeWeightInfluence`, `gravity`, `scalingRatio`, `slowDown`)
- [ ] 4.3 Expose `kill()` only on `GraphController` teardown; never restart on timeline change
- [ ] 4.4 Verify node/edge add/remove events flow into the running worker without relayout snapping

## 5. Timeline Controller & UI

- [ ] 5.1 Create `web/src/TimelineController.ts` owning timeline + accumulator + ActiveGraph + FA2 + Sigma
- [ ] 5.2 Implement RAF loop: compute targetTime from playback state/speed, `seek`, `applyDelta`, let renderer react
- [ ] 5.3 Add timeline UI controls (play/pause/scrub/speed) in `App.svelte` / `Timeline.svelte` calling the controller
- [ ] 5.4 Wire initial load position (configurable dateMin/dateMax default)
- [ ] 5.5 Remove `visibleSubset` from `lib.ts`; move date/window logic into the temporal cursor

## 6. Filter Overlays

- [ ] 6.1 Extend `reducers.ts` to read `matchCount` from edge attributes for weight filtering
- [ ] 6.2 Implement team filter + match/partner highlight as reducer overlays (dim/hide) without graph rebuild
- [ ] 6.3 Recompute win rates from `games[]` within the active window; recency as live `f(latestMatchDate, currentTime)`
- [ ] 6.4 Validate current filter UX parity against legacy path before removing it

## 7. Validation & Rollout

- [ ] 7.1 Gate temporal path behind a feature flag; keep legacy loader until validated
- [ ] 7.2 Side-by-side check: active graph at `dateMax` equals legacy `graph.json` topology (nodes/edges/counts)
- [ ] 7.3 Measure active node/edge counts at `dateMax` to decide if Non-Goals optimizations are needed now
- [ ] 7.4 Flip flag on; remove `graph` CLI, `CoOccurrenceGraph`, legacy `buildGraph`, `visibleSubset`
- [ ] 7.5 Run `just check-web` / `just lint-web`; update `README` and `AGENTS.md`
