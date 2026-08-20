## Context

Today the web viewer loads a pre-aggregated `graph.json` (static edges with baked weight/dates/recency), builds a fresh `UndirectedGraph` from the filtered subset on every filter change, and starts a new FA2 worker that runs until "settled" then stops. `dataset.json` already holds the immutable match stream (games → competitors → rosters → player IDs, dates, coach IDs). See `proposal.md` for motivation.

The goal is to invert the data flow: load `dataset.json`, derive a sorted immutable `matches[]` once, and let a reversible accumulator drive a single live Graphology projection under one always-running FA2 worker.

## Goals / Non-Goals

**Goals:**
- Replace `graph.json` consumption with direct `dataset.json` loading + in-browser temporal transform.
- Implement reversible ±1 accumulation (`playerCounts`, `pairCounts`) over a sorted match cursor.
- Mutate (not rebuild) the active Graphology graph via batched deltas.
- Run exactly one FA2 worker for the session; never restart on timeline change.
- Preserve node spatial memory via a position cache; seed new nodes near teammates.
- Drive playback from a `requestAnimationFrame` loop calling `seek`.
- Re-cast static filters as reducer overlays on the active graph.

**Non-Goals (deferred to later changes):**
- Typed-array / BigInt hot-path optimizations (profiled later).
- GPU FA2 (`@sigma/layout-fa2-gpu`, Sigma v4 alpha).
- Checkpoint-based fast seeking.
- Edge-projection subsetting when active edges exceed ~300k (FA2 edge projection).

## Decisions

### D1. `dataset.json` is the single source; drop `graph.json`
`CoOccurrenceGraph` (Python) and the `graph` CLI command are removed. The web loader (`lib.ts`) parses `dataset.json` and produces `{ matches, players, coaches, teams, games }`. This eliminates a 36 MB derived file and a redundant Python aggregation pass.
- *Alternative considered*: keep `graph.json` and add temporal fields. Rejected — it bakes derived state (recency, win rates) that the architecture wants computed live, and doubles the data contract.

### D2. Web-side match derivation
`MatchTimeline` flattens each game's international competitors into one match per team: `{ eventId, timestamp: Date.parse(date), players: roster.map(Number).sort(), teamId, coachId: coachId ? 'c_'+coachId : null }`, then sorts by `timestamp`. Coach nodes use the existing `c_<id>` namespace. The stream is frozen after load.

### D3. Accumulator is the source of truth; Graphology is the projection
`TemporalAccumulator` owns `playerCounts: Map<number, number>`, `pairCounts: Map<PairKey, number>`, `cursor`, `currentTime`. `applyMatch(match, dir)` updates counts and a `positionCache`. `seek(targetTime)` walks the cursor, collecting a single `Delta { addNodes, removeNodes, addEdges:[[a,b,count]], updateEdges:[[a,b,count]], removeEdges:[[a,b]] }`. Reversibility is guaranteed by symmetric ±1 and a `console.assert(newCount >= 0)` guard. A periodic invariant check asserts `graph edge matchCount === pairCounts.get(key)`.

### D4. Pair key
Start with string keys `a < b ? '${a},${b}' : '${b},${a}'` (consistent with existing `edgeKey`). Switch to `BigInt(a) << 32n | BigInt(b)` only if profiling shows the Map hot path is a bottleneck (per proposal §6 — profile before optimizing).

### D5. ActiveGraph wraps Graphology
`ActiveGraph` exposes `applyDelta(delta)` which: removes edges/nodes first (freeing positions into the cache), then adds nodes (seeded from cache → teammate centroid + jitter → random), then adds/updates edges. Edge attributes set `matchCount`, `weight = Math.sqrt(matchCount)`, `size = 0.5 + Math.log2(matchCount + 1)`. Mutations are coalesced; Sigma's graph events handle rendering, so no per-mutation `sigma.refresh()`.

### D6. One persistent FA2 worker
`GraphController` creates a single `FA2Layout(graph, { settings: { barnesHutOptimize: true, barnesHutTheta: 0.5, edgeWeightInfluence: 1, gravity, scalingRatio, slowDown }, weighted: true })` and `start()`s it once. The settlement/auto-stop logic in `layout.ts` is removed. Disposal only on component teardown (`layout.kill()`).

### D7. TimelineController orchestrates
`TimelineController` owns `MatchTimeline`, `TemporalAccumulator`, `ActiveGraph`, the FA2 `layout`, and `Sigma`. Its RAF loop computes `targetTime` from playback state and speed, calls `seek`, applies the `Delta`, and lets FA2/Sigma react. Same-day matches batch naturally because `seek` crosses them in one cursor walk.

### D8. Filters become overlays
`createNodeReducer`/`createEdgeReducer` already read live interaction state. They are extended to read `matchCount` from edge attributes and to honor team/weight overlays (dim/hide) without rebuilding the graph or touching FA2. `visibleSubset` in `lib.ts` is removed; its date/window logic moves into the temporal cursor.

## Risks / Trade-offs

- **[Risk] Continuous FA2 jitter** → Accept per architecture (§23): layout is iterative; reverse playback reorganizes reactively, which is the desired behavior. Tunable via `slowDown`/`scalingRatio`.
- **[Risk] Initial FA2 cost on very large active graphs** → Barnes-Hut + eventual edge-projection subset (Non-Goals) bound this; batch same-day transitions to limit per-frame topology churn.
- **[Risk] Regression in current filter UX during migration** → Keep `graph.json` loader behind a flag for one release; ship temporal path behind a feature toggle, then remove.
- **[Risk] Loss of precomputed win rates / recency** → Recompute win rates from `games[]` within the active window in the reducer/overlay layer; recency becomes `f(latestMatchDate, currentTime)` live.
- **[Trade-off] String pair keys slightly slower than BigInt** → Accepted for simplicity until profiling justifies D4's switch.

## Migration Plan

1. Land `dataset.json` loader + `MatchTimeline`/`TemporalAccumulator` with unit tests (no UI change yet).
2. Add `ActiveGraph` + persistent FA2 behind a feature flag; keep legacy `buildGraph` path working.
3. Wire `TimelineController` + RAF loop + scrubber UI; default flag off.
4. Flip flag on, run side-by-side validation (graph at `dateMax` equals legacy `graph.json` topology).
5. Remove `graph` CLI command, `CoOccurrenceGraph`, legacy `buildGraph`, and `visibleSubset`.
6. Update `AGENTS.md` commands table and `README`.

Rollback: revert the feature flag; legacy `graph.json` build and web path remain intact until step 5.

## Open Questions

- **Timeline granularity**: match-level discrete cursor vs. continuous date scrubber with interpolation. Current design uses timestamp cursor (match-level deltas) driven by a continuous-date scrubber — confirm this matches UX intent.
- **Coach temporal model**: coaches follow the same ±1 accumulator (appear/disappear with matches) — assumed yes; confirm coaches should also be scrubbable, not just players.
- **Initial load position**: default to `dateMax` (full graph, scrub back) vs `dateMin` (empty, build forward) — spec says configurable; pick a default.
- **Match count baseline**: current `dataset.json` size determines whether Non-Goals optimizations (typed arrays, edge projection) are needed immediately; measure active-node/edge counts at `dateMax` before deferring.
