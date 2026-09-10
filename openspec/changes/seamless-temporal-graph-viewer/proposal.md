## Why

The main graph viewer stutters because timeline seeks and interaction refresh a dense all-time Graphology graph, running costly per-element reducers and renderer work for every historical edge. The desired Obsidian-like experience requires nodes to enter and leave a living force-directed scene without rebuilding renderer or layout topology.

## What Changes

- Replace the renderer-facing active-topology graph with a persistent node scene and a bounded, prioritized edge scene.
- Animate timeline membership through node and edge opacity, scale, and interactivity targets rather than adding and dropping render nodes.
- Keep ForceAtlas2 continuously running against a private all-time layout topology and stream position snapshots to the scene.
- Introduce one frame-owned scheduler that coalesces timeline, filter, selection, camera, and layout updates into at most one render per animation frame.
- Adopt Sigma v4 alpha's declarative primitives, styles, depth layers, custom state, and custom WebGL layer facilities behind adapters, with a documented fallback if the pre-release API proves unsuitable.
- Replace expensive renderer reducers with incremental scene patches and dirty-range GPU updates.
- Add browser-level performance and interaction acceptance tests for production-shaped data.

## Capabilities

### New Capabilities
- `animated-temporal-scene`: Persistent, Obsidian-like node and edge transitions, bounded edge projection, and frame-scheduled scene rendering.
- `sigma-v4-rendering-adapter`: Isolated use of Sigma v4 alpha rendering primitives, styles, state, and WebGL layers.

### Modified Capabilities
- `active-graph-projection`: Replace active Graphology topology as the renderer projection with a persistent node scene and bounded edge scene.
- `timeline-visualization`: Define latest-wins scrubbing and visual enter/leave transitions.
- `persistent-layout`: Move the continuously running worker to private all-time layout topology and publish position snapshots to the renderer.

## Impact

- Affected web code: `TemporalGraph.svelte`, `TimelineController.ts`, temporal accumulator/index, `TemporalSupergraph.ts`, reducers, persistent FA2 adapter, and graph rendering utilities.
- Affected dependencies: migrate Sigma and supporting `@sigma/*` packages to the compatible v4 alpha release line after a compatibility spike; Graphology remains an adapter detail.
- Affected tests: temporal correctness tests remain; new browser performance, animation, and renderer-adapter coverage is required.
