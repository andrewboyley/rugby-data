## Context

See `proposal.md` for motivation and the delta specifications for behavior. Today, `TimelineController` owns timeline state, layout, and direct Sigma refreshes; `TemporalGraph.svelte` also refreshes Sigma reactively. A static all-time `TemporalSupergraph` is shared by ForceAtlas2 and Sigma, so every renderer refresh evaluates every historical edge. The current persistent FA2 adapter deliberately keeps one worker alive, but its Graphology graph is also the render graph.

Sigma v4 alpha changes the renderer model substantially: WebGL-rendered labels, a single shared WebGL context, declarative primitives and styles, composable depth layers, custom item state, and custom WebGL layers. It also supports scheduled partial refreshes with `partialGraph` and `skipIndexation`. These APIs are valuable for this viewer but remain pre-release, so they are confined to a replaceable adapter.

## Goals / Non-Goals

**Goals:**

- Preserve stable player positions and animate presence like Obsidian graph views while the force layout keeps moving.
- Keep timeline state exact and reversible while bounding main-thread and GPU rendering work.
- Make render invalidation explicit, coalesced, measurable, and testable without a browser renderer.
- Use Sigma v4 alpha advanced features without introducing a dependency from domain or use-case code to Sigma.

**Non-Goals:**

- Reproduce Obsidian's proprietary renderer or depend on its private APIs.
- Change rugby temporal data semantics, search behavior, or user-facing filter meaning.
- Render every active historical edge at every zoom level.
- Build a general-purpose game engine or replace Graphology/ForceAtlas2 outside the main temporal viewer.

## Decisions

### 1. Split temporal truth, layout topology, and visual scene

The system will hold three representations with distinct ownership:

```text
TemporalIndex       private LayoutGraph       persistent VisualScene
exact match facts   all-time FA2 topology     all nodes + bounded edges
       |                     |                         |
       +-- TemporalDelta ----+-- PositionSnapshot ------+-- ScenePatch --> renderer
```

- `TemporalIndex` remains the sole reversible source of current temporal membership and edge facts.
- `LayoutGraph` contains all-time nodes and weighted all-time edges. The continuous FA2 worker owns this topology and never receives timeline topology mutations.
- `VisualScene` owns stable integer slots for every node, an edge-slot budget, visual targets, and dirty ranges. It is implemented as structures of typed arrays for hot state: current/target alpha, current/target scale, interactivity, current/next position, and dirty slot sets.

This replaces the existing shared `TemporalSupergraph`. Sharing layout and render topology made worker stability depend on rendering every historical edge. A dynamic Graphology render graph was rejected because add/drop events rebuild renderer structures and make pop transitions discontinuous.

### 2. Use a visual transition system rather than topology churn

`ProjectScene` converts `TemporalDelta`, filter state, selection, and match state into target visual values. `AdvanceTransitions(now)` interpolates only slots in the active transition sets:

```text
inactive -> entering -> active -> leaving -> inactive
```

An entering node begins with alpha `0` and scale `0.55`, and reaches active targets in 140 ms. A leaving node is made non-interactive immediately and reaches alpha `0` and scale `0.55` in 100 ms. A new target replaces an in-flight target; transitions are never queued.

Edges use a separate bounded edge-slot pool. The projection ranks eligible active edges by policy, reserves slots for selected-player, partner, and match context, and fades added/removed slots. This is an explicit visual level-of-detail policy rather than silently discarding temporal facts.

Keeping persistent node slots follows the observed Obsidian pattern of changing alpha, renderability, and input state rather than removing graph objects. It is adapted here only for nodes: keeping every historical edge resident would still create unacceptable processing and visual clutter.

### 3. Make one scheduler the only render owner

`RenderScheduler` is the composition root for frame work. UI and worker callbacks publish immutable commands or snapshots; they do not call Sigma directly.

```text
input / playback / filters / selection / worker snapshot
                         |
                         v
                  latest pending state
                         |
requestAnimationFrame -> seek -> project -> transition -> upload -> render
```

The scheduler uses latest-wins semantics for scrub commands and retains a dirty-flag bitset for projection, transition, layout, camera, and overlay work. It may render at most once per animation frame. This applies the Command pattern to represent UI intent, Observer only for one-way snapshot delivery, and Dirty Flag/Double Buffer practices to avoid processing superseded state.

The existing direct `Sigma.refresh()` calls in `TimelineController` and Svelte effects are removed. The scheduler is the only adapter permitted to schedule a renderer update.

### 4. Stream continuous layout positions through double buffers

The FA2 worker remains active for the full viewer session on the immutable all-time `LayoutGraph`. The layout adapter publishes complete, indexed `Float32Array` position snapshots. It maintains previous and current snapshots; the scene interpolates them at render time.

Use transferable `ArrayBuffer` snapshots with an acknowledgement/reuse protocol first. Do not require `SharedArrayBuffer`, because it needs cross-origin isolation and would complicate current deployment. The adapter is free to add a `SharedArrayBuffer` implementation later behind the same port.

Position messages may be rate-limited under main-thread pressure, but the worker remains running. Rate limiting controls snapshot publication, not force simulation lifetime.

### 5. Migrate through a Sigma v4 adapter and capability spike

Create `SigmaV4SceneRenderer` behind a renderer port. It will:

- use declarative primitives and styles for standard node/edge appearance;
- use custom node/edge state for scene-derived visual values where supported;
- use depth layers for normal edges, selected edges, nodes, and transient overlays;
- use `partialGraph`, `skipIndexation`, and scheduled refreshes only for dirty visual elements;
- configure movement detail reduction through `hideEdgesOnMove`, `hideLabelsOnMove`, disabled edge events, and label thresholds;
- evaluate a custom WebGL layer or custom primitive layer for the bounded edge projection after the adapter spike confirms buffer-update behavior.

Pin Sigma and all `@sigma/*` packages to one verified v4 alpha set. The compatibility spike must prove primitives, custom state, layers, pointer selection, partial refreshes, browser builds, and cleanup behavior against the project test matrix. The fallback adapter uses the verified baseline Sigma path with the same scene port and no advanced layers. It preserves behavior, but may render standard edges instead of the advanced edge layer.

The application will not mix v3 and v4 renderer objects. This is a migration, not a dual-runtime compatibility layer.

### 6. Keep policies composable and local

Use strategy functions rather than a class hierarchy for policies that genuinely vary:

- `edgeDetailPolicy(scene, camera, selection)` ranks and caps rendered edges;
- `layoutWeightPolicy(allTimeCount, recency)` initializes all-time force weights;
- `transitionPolicy(changeKind)` returns visual timing and easing;
- `rendererFeaturePolicy(capabilities)` chooses advanced or fallback adapter setup.

The viewer session facade wires these policies, ports, use cases, and Svelte callbacks together. Domain and use-case types must not import renderer, worker, or Svelte modules, following the Clean Architecture dependency rule.

## Risks / Trade-offs

- [Sigma v4 alpha API regression or browser defect] -> Pin verified package versions, run compatibility tests before adoption, and retain a functionally equivalent baseline adapter.
- [All-time layout visually implies relationships outside the current time] -> Communicate temporal state through animated membership and edge projection; keep all-time layout weights documented and tuneable.
- [Continuous worker competes with lower-powered devices] -> Back-pressure snapshot frequency and edge-detail budget based on measured frame time while keeping the worker alive.
- [Bounded edges omit visible facts] -> Preserve all facts in `TemporalIndex`, make selection/match edges mandatory, and expose the budget as a tested policy rather than a hidden cutoff.
- [Typed-array scene state increases implementation complexity] -> Keep it behind `VisualScene` and test use cases against plain scene patches; avoid generic ECS or event-bus frameworks.

## Migration Plan

1. Add domain-independent scene patch and scheduler tests beside existing temporal-index tests.
2. Introduce the private all-time layout graph and position snapshot adapter while retaining the current viewer behind a feature switch.
3. Build the persistent node scene and bounded edge policy, then wire it to the baseline renderer adapter.
4. Complete the Sigma v4 alpha compatibility spike and migrate the renderer adapter only after its browser tests pass.
5. Enable the new viewer path after production-shaped interaction budgets pass; retain the prior renderer path for one release as a rollback switch.
6. Remove the prior shared supergraph renderer path and feature switch after the new path is stable.

Rollback disables the new viewer path and selects the retained baseline adapter; temporal data and index formats do not change, so no data migration is needed.

## Open Questions

- Establish the first production edge budget and device-adaptive thresholds from browser traces; this does not change the bounded-edge contract.
- Decide whether the initial all-time layout weight policy includes a recency decay after visual comparison with rugby data; this does not change worker topology stability.
