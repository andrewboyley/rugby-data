## Why

The current web viewer loads a pre-aggregated `graph.json` (static co-occurrence edges with baked-in weight, dates, and recency) and rebuilds the entire Graphology graph from scratch on every filter change, restarting the ForceAtlas2 layout each time. This makes true temporal exploration impossible: you cannot scrub a timeline, play the network forward/backward, or watch it reorganize continuously. The reference architecture (`docs/graph_architecture.md`) calls for a **reversible temporal accumulator feeding one persistent FA2 simulation** — a single continuous physics simulation whose topology changes over time, rather than a sequence of precomputed layouts.

Critically, `dataset.json` already contains the immutable match-level temporal data (games → competitors → rosters with player IDs, dates, coach IDs). The pre-aggregated `graph.json` is derived state we can stop producing and instead derive at runtime.

## What Changes

- **BREAKING**: Remove the `graph` CLI subcommand and the `CoOccurrenceGraph` Python class (`src/rugby_composition_predictor/graph.py`). The pipeline stops at `dataset.json`.
- **BREAKING**: The web app no longer loads `graph.json`. It loads `dataset.json` directly and transforms the `games[]` arrays into a sorted, immutable `matches[]` temporal stream at load time.
- Introduce a **reversible temporal accumulator** (`playerCounts`, `pairCounts` Maps) with `applyMatch(match, ±1)` and a timeline cursor (`seek(targetTime)`) — forward/backward playback without reconstructing the graph.
- Introduce an **active Graphology projection** that holds only currently-active nodes/edges and is mutated via batched deltas (add/remove node, add/update/remove edge) rather than rebuilt.
- Introduce a **position cache** so players keep spatial memory when they disappear and reappear across timeline reversals.
- Introduce a **single persistent FA2 worker** that starts once and never restarts when the timeline changes; topology deltas flow into the running simulation.
- Introduce a **separate raw `matchCount` / layout `weight` (`sqrt`) / visual `size` (`log2`)** triple per edge, so heavily-played relationships do not dominate the physics while still rendering dramatically.
- Introduce a **timeline UI controller** (play/pause, scrubber, speed) driving a `requestAnimationFrame` loop that calls `seek` and applies deltas; same-day matches are grouped into one logical transition.
- Re-cast existing static filters (team, match highlight, min/max edge weight) as **overlays on the temporal state** rather than graph-rebuild triggers.

## Capabilities

### New Capabilities
- `temporal-graph-engine`: Immutable match-stream source of truth, reversible accumulator (player/pair counts), and timeline cursor with forward/backward `seek`.
- `active-graph-projection`: Active Graphology graph holding only current topology, delta-based mutation, position cache, and separated matchCount/layoutWeight/visualSize.
- `persistent-layout`: Single FA2 worker running continuously across timeline changes (Barnes-Hut, never restarted).
- `timeline-visualization`: Timeline controller, RAF playback loop, same-day batching, and UI controls integrated with the existing filter overlays.

### Modified Capabilities
<!-- None — greenfield OpenSpec project; no existing specs are modified. -->

## Impact

- **Python**: `graph.py`, `cli.py` (`build_graph` removed), `dataset.py` (if any load contract changes), `AGENTS.md` (commands table updated).
- **Web data layer**: `lib.ts` (`parseGraph` replaced by dataset loader producing `matches[]`), `types.ts` (new `Match`, `Delta`, `PairKey` types).
- **Web graph layer**: New `web/src/temporal/` (engine), `web/src/graph/ActiveGraph.ts` (replaces ad-hoc `buildGraph`), `web/src/graph/layout.ts` (persistent worker), `web/src/graph/reducers.ts` (simplified to read edge attributes from active graph).
- **Web controller/UI**: New `TimelineController.ts`; `GraphController.ts` refactor to own persistent layout; `App.svelte`/`Timeline.svelte` wired to timeline.
- **Dependencies**: `graphology`, `graphology-layout-forceatlas2` already present; no new runtime deps required for the initial build (GPU FA2 deferred).
- **Data contract**: `graph.json` consumers (web, any scripts) must migrate to `dataset.json`. `data/graph.json` becomes obsolete.
