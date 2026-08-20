# Efficient Temporal Rugby Network Visualization — Revised Implementation Specification

**Status:** Revised implementation document  
**Date:** 17 August 2026  
**Basis:** Original uploaded design document plus current online research  
**Primary goal:** Build a temporal rugby player network that can move forward and backward through history, remain visually stable, and stay responsive as the dataset grows.

---

## 1. Executive decision

The original design has the right foundation:

- immutable match data;
- a reversible temporal accumulator;
- a cumulative weighted player graph;
- persistent node positions;
- batched temporal updates;
- Sigma.js/WebGL for rendering.

Those choices should be retained.

The main redesign is around the **layout boundary**.

The original proposal assumes that the stock `graphology-layout-forceatlas2` worker can remain alive while the Graphology graph changes and that edge-weight changes will automatically affect its physics. The current implementation does not support that model. The current worker listens to `nodeAdded`, `edgeAdded`, `nodeDropped`, and `edgeDropped`; a topology change terminates and respawns the worker, rebuilding its matrices. It does not listen for `edgeAttributesUpdated`. citeturn278327view0

The current package is also old: `graphology-layout-forceatlas2` is at version 0.10.1 and was published years ago. citeturn199199search6turn199199search7

### Recommended architecture

Build the system around these four persistent states:

```text
                    IMMUTABLE DATA
                 players + matches
                         │
                         ▼
                 TEMPORAL ENGINE
             counts + checkpoints + cursor
                         │
                         ▼
                TEMPORAL DELTA
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
       ANALYTICAL GRAPH         LAYOUT STATE
        active nodes/edges       x/y/vx/vy
              │                     │
              └──────────┬──────────┘
                         ▼
                     SIGMA.JS
                      WebGL
                         │
                         ▼
                       USER
```

The key principle is:

> **The temporal engine is persistent. The active analytical graph is persistent. The layout state is persistent. The implementation must not depend on the stock FA2 worker being a persistent mutable physics engine.**

---

# 2. What the system should mean

## 2.1 Use a cumulative temporal projection

For the rugby use case, the graph should represent accumulated co-appearance/co-membership up to the selected time:

```text
playerCount(P, T)
    = number of relevant appearances/events for P through T

pairCount(A, B, T)
    = number of relevant matches through T containing A and B
```

The graph is therefore a **cumulative weighted projection**.

If Alice and Bob appear together in three matches:

```text
2019: A ─ B
2020: A ─ B
2021: A ─ B
```

then at 2021:

```text
edge(A, B).matchCount = 3
```

The edge remains present because the relationship is cumulative.

Do not switch to an interval/active-state graph unless the question changes to something like:

- currently employed together;
- currently contracted together;
- currently connected;
- currently active relationship.

That is a different temporal model.

---

# 3. Define the semantic primitive before optimizing it

There is one important domain choice that should be made explicitly.

## 3.1 Match membership model

A match contributes:

```text
+1 appearance to every relevant player
+1 co-appearance to every unordered pair
```

For a 23-player match:

```text
23 players
23 * 22 / 2 = 253 pair updates
```

This is a very practical representation for squad-level collaboration.

## 3.2 Minutes-overlap model

If the graph is intended to mean "these players were actually playing together", a match should instead contain on-field intervals.

Example:

```text
A: 0–80 minutes
B: 0–80 minutes
C: 70–80 minutes
```

Then:

```text
A-B overlap = 80
A-C overlap = 10
B-C overlap = 10
```

That model is more semantically precise but more expensive and more complicated.

### Recommendation

Implement **match membership first**.

Keep the data model extensible enough to support duration-weighted events later.

Do not introduce minutes-overlap until the product requirement actually needs it.

---

# 4. Separate the state into explicit layers

Do not store one "weight" and use it for everything.

An edge should conceptually have:

```ts
type PairState = {
    matchCount: number;
    layoutWeight: number;
    visualWidth: number;
    firstMatch: number;
    lastMatch: number;
};
```

These represent different questions.

### `matchCount`

Analytical truth:

> How many matches contributed to this relationship?

### `layoutWeight`

Physics:

> How strongly should this relationship influence spatial organization?

### `visualWidth`

Rendering:

> How strongly should this relationship be shown to the user?

### `firstMatch` / `lastMatch`

Temporal metadata:

> When did this relationship begin and most recently occur?

Do not use a single raw count for all four purposes.

---

# 5. The temporal engine is the core system

The temporal engine should be deterministic, reversible, and independent of Sigma.

## 5.1 Data model

Normalize matches into dense integer IDs.

```ts
type PlayerId = number;
type MatchId = number;

type Match = {
    id: MatchId;
    timestamp: number;
    players: Uint32Array;
};
```

Players should be remapped to dense IDs:

```text
original player identifier
        ↓
dense integer ID
        ↓
0, 1, 2, 3, ...
```

This allows typed arrays and compact numeric storage.

---

# 6. Sort matches once

At load time:

```text
matches
    ↓
sort by timestamp
    ↓
dense Match[]
```

Keep the historical dataset immutable.

Never reorder it during interaction.

The timeline then operates on a cursor:

```ts
type TemporalCursor = {
    matchIndex: number;
    timestamp: number;
};
```

---

# 7. Use checkpoints from the beginning

The original proposal suggested checkpoints only if large seeks become slow.

For an efficient implementation, use them from the beginning.

However, checkpoints should store **analytical state only**, not Graphology or Sigma state.

A checkpoint contains:

```ts
type TemporalCheckpoint = {
    matchIndex: number;
    playerCounts: Uint32Array;
    pairCounts: ...;
};
```

Do not store a complete Graphology graph at every checkpoint.

## Recommended spacing

Start with:

```text
256 matches/checkpoint
```

Then benchmark:

```text
128
256
512
1024
```

The correct value depends on the dataset and memory budget.

A seek becomes:

```text
target T
   ↓
nearest checkpoint
   ↓
restore compact state
   ↓
replay at most checkpointInterval matches
   ↓
produce exact target state
```

This gives bounded seek cost without storing redundant full graph snapshots.

---

# 8. Forward and reverse operations must be mathematically symmetrical

The fundamental invariant is:

```text
state(T2) = state(T1) + delta(T1, T2)
```

and:

```text
state(T1) = state(T2) - delta(T1, T2)
```

For one match:

```ts
applyMatch(match, +1)
applyMatch(match, -1)
```

The same function handles both directions.

Pseudo-code:

```ts
function applyMatch(match: Match, direction: 1 | -1) {
    for (const player of match.players) {
        playerCounts[player] += direction;
    }

    for (let i = 0; i < match.players.length; i++) {
        const a = match.players[i];

        for (let j = i + 1; j < match.players.length; j++) {
            const b = match.players[j];

            pairCounts.increment(
                pairKey(a, b),
                direction
            );
        }
    }
}
```

This is much safer than maintaining separate forward and backward algorithms.

---

# 9. Do not scan historical data on every timeline frame

Never implement:

```text
timeline change
    ↓
scan all previous matches
    ↓
rebuild counters
    ↓
rebuild graph
```

The whole point of the accumulator is to avoid this.

For normal movement:

```text
advance cursor
    ↓
apply only new matches
```

or:

```text
rewind cursor
    ↓
subtract only removed matches
```

For large seeks:

```text
nearest checkpoint
    ↓
restore
    ↓
replay a bounded number of matches
```

---

# 10. Optimize the pair representation

There are three practical levels.

## Level 1 — start here

Use a numeric pair key with a `Map<number, number>`.

If player IDs fit in 16 bits:

```ts
function pairKey(a: number, b: number): number {
    if (a > b) [a, b] = [b, a];
    return a * 65536 + b;
}
```

This is substantially simpler than string keys.

## Level 2 — if the player universe is larger

Use a two-part numeric key or a `BigInt` key.

Do this only if required.

## Level 3 — genuinely huge data

If profiling shows millions of active pairs and `Map` becomes a material bottleneck, replace the hot map with a custom packed hash table backed by typed arrays.

Do not start there.

The most important performance wins are:

```text
avoid full historical rescans
avoid graph reconstruction
avoid layout restarts
avoid large main-thread/worker object copies
```

Graphology's own performance guidance recommends callback iteration methods when iterating an existing graph because they avoid intermediate arrays and repeated lookups. citeturn429943search3

---

# 11. Separate temporal state from Graphology

This is the most important implementation boundary.

The temporal engine should not directly mutate Sigma or Graphology.

Instead:

```ts
type TemporalDelta = {
    fromMatchIndex: number;
    toMatchIndex: number;

    addedPlayers: Uint32Array;
    removedPlayers: Uint32Array;

    addedPairs: Uint32Array;
    removedPairs: Uint32Array;

    updatedPairs: Uint32Array;

    matchIds: Uint32Array;
};
```

The UI layer then applies that delta.

This gives the system a single path:

```text
temporal state
    ↓
delta
    ↓
graph projection
```

There should not be multiple independent code paths that modify the graph.

---

# 12. Use a persistent active Graphology projection

Graphology should contain only the graph visible to the current view.

It is a **projection**, not the historical database.

Conceptually:

```text
immutable matches
        │
        ▼
temporal accumulator
        │
        ▼
active player/pair state
        │
        ▼
Graphology
```

Do not rebuild Graphology when the timeline changes.

Use:

```text
add only new nodes
drop only nodes that leave the projection
add only newly-created edges
drop only zero-count edges
update only changed edge attributes
```

---

# 13. Minimize Graphology mutations

Sigma's current architecture is efficient at rendering, but its processing phase can be expensive because data updates may require processing every element. State-only changes are considerably cheaper. citeturn123785search3

Therefore, do not do this on every timeline tick:

```ts
graph.forEachEdge(...)
graph.setEdgeAttribute(...)
```

for every edge.

Instead:

1. determine exactly which pairs changed;
2. update only those pairs;
3. batch the updates into one temporal transition;
4. schedule one render/process cycle.

Graphology explicitly provides `updateEachEdgeAttributes` as its performant bulk edge-attribute update method and supports hints about changed attribute names. citeturn429943search0

Use this when many visible edges genuinely need attribute changes.

---

# 14. Do not let Graphology own the physics state

The layout state should be conceptually separate:

```ts
type LayoutState = {
    x: Float32Array;
    y: Float32Array;
    vx: Float32Array;
    vy: Float32Array;
};
```

The layout worker should use dense numeric arrays.

Graphology/Sigma uses string identifiers and rich JavaScript objects because that is convenient for application logic.

The physics engine should not pay that cost on every iteration.

---

# 15. Main-thread / worker architecture

Use at least two execution domains.

```text
MAIN THREAD
    ├── UI
    ├── timeline controls
    ├── Graphology
    └── Sigma

WORKER
    ├── temporal accumulator
    ├── checkpoints
    └── layout physics
```

The worker boundary should use typed-array buffers wherever practical.

Passing normal JavaScript objects between worker and main thread invokes structured cloning. Transferring `ArrayBuffer`s lets ownership move without copying the underlying memory. citeturn496987search0turn496987search1

---

# 16. Worker message protocol

Use a small binary-oriented protocol.

Example:

```ts
type WorkerCommand =
    | {
          type: "APPLY_DELTA";
          deltaBuffer: ArrayBuffer;
      }
    | {
          type: "SEEK";
          targetMatchIndex: number;
      }
    | {
          type: "START";
      }
    | {
          type: "STOP";
      }
    | {
          type: "RESET";
      };
```

Worker responses:

```ts
type WorkerEvent =
    | {
          type: "STATE";
          positions: ArrayBuffer;
          changedPairs: ArrayBuffer;
      }
    | {
          type: "READY";
      }
    | {
          type: "METRICS";
          metrics: Float64Array;
      };
```

Do not send large arrays of JavaScript objects every frame.

---

# 17. SharedArrayBuffer is optional, not mandatory

`SharedArrayBuffer` can eliminate some message-copy boundaries, but it also introduces concurrency and synchronization complexity. MDN explicitly notes that shared memory has determinism, security, and performance considerations. citeturn496987search13turn301225search7

Start with transferred `ArrayBuffer`s.

Only move to `SharedArrayBuffer` after profiling proves that message transfer is a bottleneck.

---

# 18. Layout engine decision: use an adapter interface

Do not make the application depend directly on FA2.

Define:

```ts
interface LayoutEngine {
    initialize(graph: LayoutGraph, state: LayoutState): void;

    applyDelta(delta: LayoutDelta): void;

    reheat(amount: number): void;

    start(): void;
    stop(): void;

    getPositions(): Float32Array;

    destroy(): void;
}
```

Then implement:

```text
ForceAtlas2 CPU worker
D3-force worker
GPU ForceAtlas2
```

behind the same interface.

This makes benchmarking useful rather than dangerous.

---

# 19. Candidate A — Sigma v4 GPU ForceAtlas2

This should now be the first thing to benchmark.

Sigma's v4 documentation has a GPU ForceAtlas2 implementation:

```ts
import { ForceAtlas2GPULayout } from "@sigma/layout-fa2-gpu";
```

The official example is configurable for thousands of nodes and edges and exposes adaptive iterations-per-frame. One current example uses 5,000 nodes and 10,000 edges. citeturn123785search0

Sigma v4's rendering architecture is also entirely WebGL-based and is designed to handle large graph rendering efficiently. citeturn123785search4

### Important caveat

Do not assume the GPU FA2 package automatically handles the exact mutation pattern required by this application.

The benchmark must specifically test:

```text
edge addition
edge removal
edge weight change
node addition
node removal
continuous position preservation
reheat after delta
```

The official examples establish the GPU layout and large-graph capability, but that is not the same as proving ideal behavior for a continuously mutating temporal graph. citeturn123785search0turn123785search2

---

# 20. Candidate B — custom incremental FA2 worker

If GPU FA2 does not provide efficient incremental topology/weight updates, build a custom worker derived from the FA2 implementation.

The important difference is not the force model.

The difference is the update protocol.

Instead of:

```text
Graphology event
    ↓
restart worker
    ↓
rebuild matrices
```

use:

```text
Temporal delta
    ↓
ADD_NODE
REMOVE_NODE
ADD_EDGE
REMOVE_EDGE
SET_EDGE_WEIGHT
    ↓
existing physics state continues
```

The current Graphology worker does not provide this behavior. It registers listeners for node/edge addition/removal and respawns its worker on those events. Its matrices are rebuilt when the layout starts or is respawned. citeturn278327view0

That is precisely the layer that should be replaced.

---

# 21. Candidate C — D3-force in a worker

D3-force is a strong fallback because its simulation is naturally mutable.

A useful pattern is:

```ts
simulation
    .force("link")
    .links(currentLinks);

simulation
    .alpha(reheatAmount)
    .restart();
```

The model already maintains:

```text
x
y
vx
vy
```

so persistent positions and controlled reheating are natural.

D3-force's many-body force uses a Barnes-Hut quadtree approximation, making the repulsion step roughly O(n log n) rather than O(n²). citeturn496987search5

The trade-off is that a D3 worker requires an explicit bridge back to Graphology/Sigma.

---

# 22. Recommended layout selection strategy

Do not pick a layout engine by library popularity.

Pick it from benchmark results.

### Initial order to test

```text
1. Sigma v4 GPU FA2
2. Custom incremental FA2 worker
3. D3-force worker
```

### Decision rule

Choose the solution that satisfies all three:

```text
interactive frame time
+
acceptable layout quality
+
stable updates during temporal changes
```

A layout that is technically fast but visually unstable is not an optimization.

---

# 23. Keep the layout state persistent

The layout should never be reset just because the timeline moved.

The ideal behavior is:

```text
2018 layout
   ↓
2019 delta
   ↓
same x/y state
   ↓
small adjustment
```

not:

```text
2018 layout
   ↓
2019 delta
   ↓
randomize layout
   ↓
recompute everything
```

ForceAtlas2 is explicitly a continuous force-directed algorithm, where forces operate continuously as the layout runs. citeturn301225search1

---

# 24. Position memory

Keep a persistent position store indexed by dense player ID:

```ts
positionsX: Float32Array
positionsY: Float32Array
```

When a player disappears:

```text
graph projection:
    player removed

position cache:
    player position retained
```

When the player returns:

```text
reuse previous x/y
```

This makes timeline navigation much less disorienting.

However, do not hard-lock old positions.

Previous position should be an **initial condition**, not a rigid constraint.

Research on dynamic graph drawing does not support a universal rule that maximal mental-map preservation always improves comprehension. citeturn301225search4

So:

```text
position memory = yes
hard position constraint = no
```

---

# 25. Add controlled reheating

Temporal updates should alter the physical simulation temperature.

Do not use a binary rule:

```text
change = reheat a lot
```

Use a magnitude-based rule.

For example:

```ts
function reheatAmount(delta: LayoutDelta): number {
    return clamp(
        baseReheat
        + nodeAdditionWeight * delta.addedNodes
        + nodeRemovalWeight * delta.removedNodes
        + edgeTopologyWeight * delta.topologyChanges
        + edgeWeightWeight * delta.weightChanges,
        0,
        maxReheat
    );
}
```

Suggested relative ordering:

```text
weight-only change       → smallest reheat
edge topology change     → small reheat
new player               → larger reheat
large historical seek    → controlled large reheat
```

The goal is:

```text
small update
    → subtle movement

large update
    → noticeable reorganization
```

not constant explosions of the graph.

D3-force exposes this model through simulation alpha/restart controls, which makes it a useful reference for the behavior even if FA2 is ultimately used. citeturn301225search1

---

# 26. Reheating should also depend on interaction mode

Implement three modes.

## Normal playback

```text
small deltas
continuous physics
moderate reheat
```

## Timeline scrubbing

```text
coalesce changes
low physics budget
avoid full settling
```

## Timeline release

```text
apply exact target state
stronger controlled reheat
allow layout to settle
```

This is critical.

If the user drags a slider rapidly:

```text
2010
2011
2012
2013
...
2025
```

do not perform a full physics update for every intermediate pointer position.

Instead:

```text
pointer movement
    ↓
throttle/debounce
    ↓
target state
    ↓
one consolidated delta
```

---

# 27. Timeline resolution should determine batching

Do not hard-code "same day" as the only batch rule.

Define:

```ts
timelineResolution =
    "match"
    | "day"
    | "week"
    | "month"
    | "season"
    | "year";
```

Then:

```text
timeline resolution
    ↓
temporal delta grouping
    ↓
one Graphology update
    ↓
one layout reheat
```

This scales cleanly to different views.

---

# 28. Fast seek path

Implement:

```ts
seekTo(matchIndex)
```

with two strategies.

### Nearby seek

If:

```text
abs(target - cursor) <= threshold
```

walk incrementally.

### Long seek

Otherwise:

```text
checkpoint
    ↓
restore accumulator
    ↓
replay to target
```

For example:

```text
threshold = 256
checkpoint interval = 256
```

Benchmark these values.

---

# 29. Temporal worker optimization

The temporal worker should work only with:

```text
dense integer IDs
typed arrays
numeric counters
sorted indices
```

Avoid:

```text
objects per player per match
objects per pair update
string pair keys in the hot loop
JSON serialization
```

The raw input can remain ergonomic.

Normalize once.

Then execute the hot path numerically.

---

# 30. Precompute what is invariant

A match's player list never changes.

Precompute:

```ts
match.players
match.pairOffsets
match.playerCount
```

For repeated processing of exactly the same match list, the pair indices can also be precomputed.

For example:

```text
match 381

players:
[4, 11, 28, 41, 57]

pairs:
(4,11)
(4,28)
(4,41)
...
```

The accumulator then only needs to increment/decrement counters.

### Trade-off

Precomputing all pair lists increases memory usage.

For typical rugby squad sizes, the CPU savings are modest.

Benchmark before adding this layer.

---

# 31. Avoid allocating during the hot loop

The hot path should not repeatedly allocate:

```js
[a, b]
{source, target}
`${a}:${b}`
```

Prefer:

```ts
for (let i = 0; i < players.length; i++) {
    const a = players[i];

    for (let j = i + 1; j < players.length; j++) {
        const b = players[j];
        ...
    }
}
```

Use reusable scratch buffers for deltas.

Typed arrays and transferable buffers should be preferred for large worker messages. citeturn496987search0

---

# 32. Graph update strategy

For one temporal delta:

```text
1. determine changed player IDs
2. determine changed pair IDs
3. add/drop topology
4. update only changed counts
5. update visual attributes only when needed
6. notify/reheat layout once
7. schedule one Sigma refresh
```

Do not interleave:

```text
one pair update
→ graph mutation
→ render
→ one pair update
→ graph mutation
→ render
```

That is the wrong granularity.

The unit of work is the **temporal delta**, not the individual edge.

---

# 33. Visual state belongs in Sigma

Keep interaction state outside analytical data:

```text
selected
hovered
search match
faded
focused
```

Sigma's renderer already separates graph data from rendering behavior and supports state-aware styling. citeturn123785search3

This means:

```text
timeline state
    → graph data

hover state
    → visual state

search state
    → visual state

selection state
    → visual state
```

Do not rewrite the whole graph for hover/highlight operations.

---

# 34. LOD is mandatory for a serious implementation

A graph can be technically renderable and still unusable.

Use at least three display levels.

## Zoomed out

```text
nodes: small
labels: disabled
edges: thin
edge labels: disabled
```

## Medium

```text
important labels
strong edges visible
```

## Zoomed in

```text
player names
match counts
edge metadata
```

Sigma v4's rendering model is GPU-oriented and its label/rendering settings expose mechanisms for controlling the amount of visual work. citeturn123785search4turn123785search9

The v4 website specifically describes rendering large graphs and includes a 9,000-node example. citeturn123785search5

---

# 35. Hide edges while moving the camera when useful

Sigma v4 exposes:

```text
hideEdgesOnMove
```

and event features that can be disabled when performance matters. citeturn123785search9

For very large graphs, consider:

```text
camera moving
    → reduce expensive visual details

camera stopped
    → restore full presentation
```

Do not hide information during normal use unless the graph size actually warrants it.

---

# 36. Separate layout edge weight from visual edge width

Recommended starting formulas:

```ts
layoutWeight(count) =
    Math.log1p(count);
```

and:

```ts
visualWidth(count) =
    minWidth + scale * Math.sqrt(count);
```

This prevents high-frequency relationships from completely dominating the physical layout.

ForceAtlas2's edge-weight influence has a strong effect on layout shape, so using raw count as both a physical and visual scale can produce overly dominant hubs. citeturn301225search1

---

# 37. Consider a saturating layout weight

An alternative is:

```ts
function layoutWeight(count: number, tau = 8) {
    return 1 - Math.exp(-count / tau);
}
```

This makes the first few shared matches matter more than later repetitions.

Example:

```text
count   weight
1       0.117
2       0.221
5       0.465
10      0.713
20      0.918
50      0.998
```

This is not a statistical truth. It is a visualization design choice.

Start with `log1p` because it is simpler. Evaluate the saturating form if hubs dominate the layout.

---

# 38. Benchmark LinLog

ForceAtlas2 includes a LinLog mode specifically aimed at producing tighter community-oriented layouts. The original FA2 paper explains that LinLog changes attraction behavior and often produces tighter clusters. citeturn301225search1

Benchmark:

```text
FA2
FA2 + LinLog
```

Use the option that makes rugby structures easier to read.

Do not pick one solely because it looks good on a random graph.

Use representative rugby data.

---

# 39. Benchmark hub handling

ForceAtlas2 also includes a hub-related attraction distribution mechanism.

Rugby networks can contain very high-degree players:

```text
player
  ↙ ↓ ↘
many teammates
```

Benchmark:

```text
outboundAttractionDistribution = false

vs

outboundAttractionDistribution = true
```

The original FA2 paper describes the "Dissuade Hubs" mechanism as reducing attraction from high-degree nodes. citeturn301225search1

Again, benchmark the result rather than assuming the default is right.

---

# 40. Community structure should remain analytical metadata

Possible metadata dimensions include:

```text
club
country
competition
season
position
generation
```

Use them for:

```text
filtering
coloring
highlighting
analysis
search
```

Do not hard-code those groups into the physics unless the visualization's purpose explicitly requires it.

The network should remain capable of revealing relationships that are not obvious from metadata.

---

# 41. Architecture diagram

```text
                         ┌─────────────────────┐
                         │   IMMUTABLE DATA    │
                         │ players + matches   │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │  TEMPORAL INDEX     │
                         │ sorted timestamps   │
                         │ checkpoints         │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ TEMPORAL ACCUMULATOR │
                         │ playerCounts         │
                         │ pairCounts           │
                         │ cursor               │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   TEMPORAL DELTA    │
                         │ add/remove/update   │
                         └──────────┬──────────┘
                                    │
                  ┌─────────────────┴──────────────────┐
                  ▼                                    ▼
        ┌──────────────────┐                 ┌──────────────────┐
        │ GRAPH PROJECTION │                 │  LAYOUT ENGINE   │
        │    Graphology    │                 │ x/y/vx/vy state  │
        └────────┬─────────┘                 └────────┬─────────┘
                 │                                    │
                 └────────────────┬───────────────────┘
                                  ▼
                         ┌──────────────────┐
                         │     SIGMA.JS     │
                         │      WebGL       │
                         └────────┬─────────┘
                                  │
                                  ▼
                              USER VIEW
```

---

# 42. Recommended thread model

```text
MAIN THREAD

UI
 │
 ├── timeline
 ├── selection
 ├── hover
 └── camera
 │
 ▼
Graphology
 │
 ▼
Sigma
 │
 ▼
WebGL


WORKER 1 — TEMPORAL

matches
 │
 ▼
checkpoint index
 │
 ▼
accumulator
 │
 ▼
delta


WORKER 2 — PHYSICS

layout state
 │
 ├── repulsion
 ├── attraction
 ├── gravity
 └── integration
 │
 ▼
positions
```

A first implementation can combine the temporal and layout workers.

Split them later if profiling shows value.

---

# 43. Why not put everything in one worker?

Because they have different timing needs.

Temporal processing is event-driven:

```text
timeline changed
    ↓
compute exact state
```

Physics is continuous:

```text
60-ish updates/second
```

Keeping the systems logically separate lets the physics continue while the temporal system is idle.

It also allows a future GPU layout to replace the CPU layout without changing the temporal engine.

---

# 44. Future GPU path

WebGPU is intended for GPU computation as well as rendering, but support is not yet universal enough to make it the only implementation. MDN currently labels the WebGPU API as limited availability. citeturn496987search7

Therefore:

```text
WebGPU
    = optimization path

not

WebGPU
    = required baseline
```

If a later custom physics engine moves to GPU compute:

```text
pair arrays
node arrays
velocity arrays
edge weights
        ↓
WebGPU compute
        ↓
positions
        ↓
Sigma/WebGL
```

That can become the high-scale mode.

---

# 45. OffscreenCanvas

OffscreenCanvas is broadly available and can allow rendering operations to occur in a worker. citeturn301225search2turn301225search5

However, do not introduce it merely because it exists.

Sigma's normal model is already GPU-based.

Use OffscreenCanvas only if profiling shows that the main-thread rendering/processing lifecycle is a material bottleneck and the chosen Sigma version supports the required architecture cleanly.

---

# 46. The most important performance optimization: do less work

Prioritize optimizations in this order:

```text
1. avoid historical rescans
2. avoid graph reconstruction
3. avoid physics restarts
4. avoid unnecessary graph attribute updates
5. minimize worker message volume
6. minimize allocations
7. optimize pair storage
8. optimize low-level arithmetic
```

Do not reverse this order.

A faster pair hash does not matter if the application is rebuilding a 100,000-edge graph on every timeline change.

---

# 47. Input data strategy

Keep a normalized canonical dataset:

```text
players
matches
matchPlayers
metadata
```

Recommended logical tables:

### `players`

```text
playerId
name
...
```

### `matches`

```text
matchId
timestamp
competitionId
seasonId
...
```

### `matchPlayers`

```text
matchId
playerId
role
...
```

The browser runtime can then transform these tables into compact worker-friendly arrays.

---

# 48. Runtime data representation

Runtime representation should look more like:

```text
matchOffsets: Uint32Array
matchPlayers: Uint32Array
matchTimes: Float64Array
```

than:

```ts
Match[] {
    players: Player[]
}
```

The source format can stay readable.

The hot runtime format should be compact.

For example:

```text
match 0: players[0..22]
match 1: players[23..45]
...
```

using offsets:

```ts
matchOffsets[i]
matchOffsets[i + 1]
```

This avoids thousands of small arrays.

---

# 49. Compact match storage

Use CSR-like storage:

```text
matchOffsets:
[0, 23, 46, 69, ...]

matchPlayers:
[2, 17, 41, ...]
```

For match `i`:

```ts
const start = matchOffsets[i];
const end = matchOffsets[i + 1];

for (let p = start; p < end; p++) {
    const player = matchPlayers[p];
}
```

This representation is cache-friendly and easy to transfer to a worker.

---

# 50. Pair state storage

Recommended first implementation:

```ts
const pairCounts = new Map<number, number>();
```

Then:

```ts
const previous = pairCounts.get(key) ?? 0;
const next = previous + direction;

if (next === 0) {
    pairCounts.delete(key);
} else {
    pairCounts.set(key, next);
}
```

If profiling later shows this is the hot bottleneck, replace it with a packed hash table.

---

# 51. Use dense integer IDs everywhere internally

Do not do this in the hot path:

```text
"beauden-barrett"
"owen-farrell"
"some-player-id"
```

Do this:

```text
17
42
381
```

Keep a lookup table for presentation:

```ts
playerNames[playerId]
```

---

# 52. Exact update lifecycle

When the timeline advances:

```text
timeline input
    │
    ▼
quantize to timeline resolution
    │
    ▼
temporal engine
    │
    ├── nearby → incremental apply
    └── far    → checkpoint + replay
    │
    ▼
TemporalDelta
    │
    ├───────────────┐
    ▼               ▼
Graph projection   Layout projection
    │               │
    ▼               ▼
Sigma refresh      reheat(delta)
                    │
                    ▼
                continuous physics
```

---

# 53. Seek algorithm

```ts
function seekTo(target: number) {
    const distance = target - cursor.matchIndex;

    if (Math.abs(distance) <= INCREMENTAL_THRESHOLD) {
        return applyIncrementally(distance);
    }

    const checkpoint = findNearestCheckpoint(target);

    restoreCheckpoint(checkpoint);

    replayTo(target);

    cursor.matchIndex = target;
}
```

The resulting state must be mathematically identical regardless of whether the user reached it by:

```text
playing forward
rewinding
jumping
scrubbing
```

---

# 54. Correctness invariant

At all times:

```text
active player set
=
{players with playerCount > 0}
```

and:

```text
active edge set
=
{pairs with pairCount > 0}
```

This should be validated in development mode.

For every Graphology edge:

```text
graph edge count
=
pairCounts[key]
```

and for every Graphology node:

```text
graph node exists
iff playerCounts[playerId] > 0
```

---

# 55. Property-based temporal tests

Generate small synthetic histories.

For example:

```text
Match 1: A B C
Match 2: A B
Match 3: B C
```

Then verify:

```text
T0:
none

T1:
A=1 B=1 C=1
AB=1 AC=1 BC=1

T2:
A=2 B=2 C=1
AB=2 AC=1 BC=1

T3:
A=2 B=3 C=2
AB=2 AC=1 BC=2
```

Then reverse:

```text
T3 → T2 → T1 → T0
```

and compare against the original expected state.

---

# 56. State equivalence testing

Implement a slow but obviously correct reference implementation:

```ts
rebuildFromHistory(target)
```

Use it only in tests.

Then compare:

```text
incremental accumulator
        vs
full historical rebuild
```

at random timeline positions.

This catches temporal bugs without making the production path slow.

---

# 57. Layout regression tests

Store benchmark snapshots:

```text
dataset
node count
edge count
layout settings
initial seed
```

Measure:

```text
layout convergence
frame time
CPU time
memory
position displacement
```

Do not compare exact coordinates because force-directed layouts are not inherently meaningful in absolute coordinate terms and can be sensitive to initial conditions. ForceAtlas2's own paper notes that layouts depend on starting conditions and are not deterministic coordinate projections. citeturn301225search1

---

# 58. Visual stability metric

Measure movement after a temporal delta:

```text
mean displacement
median displacement
95th percentile displacement
maximum displacement
```

Separate:

```text
new nodes
existing nodes
removed nodes
```

A good update should produce:

```text
small delta
    → small existing-node movement

large delta
    → larger but controlled movement
```

This gives a real metric for "visual stability".

---

# 59. Benchmark dataset

Create synthetic rugby-like graphs.

Do not benchmark only random Erdős-Rényi graphs.

Use at least:

### Dataset A — sparse

```text
1,000 nodes
5,000 edges
```

### Dataset B — medium

```text
3,000 nodes
25,000 edges
```

### Dataset C — large

```text
10,000 nodes
100,000 edges
```

### Dataset D — dense

```text
10,000 nodes
500,000+ edges
```

### Dataset E — highly dynamic

High rate of:

```text
new players
new edges
edge removals
```

### Dataset F — hub-heavy

A small number of players have very high degree.

This tests the cases most likely to destabilize the layout.

---

# 60. Benchmark temporal operations

Measure:

```text
apply one match
rewind one match
advance one day
advance one season
seek one year
seek ten years
rapid scrubbing
```

Record:

```text
median latency
p95 latency
p99 latency
allocations
GC pauses
```

The target should be defined in terms of user experience.

Example initial goals:

```text
normal timeline update:
< 16 ms main-thread work where feasible

typical nearby seek:
< 16–33 ms

large seek:
< 100 ms for normal datasets

scrubbing:
no sustained main-thread freezes
```

These are engineering targets, not guarantees.

---

# 61. Benchmark layout operations

For every candidate layout engine measure:

```text
initial convergence
steady-state CPU/GPU usage
position update latency
topology update latency
weight update latency
reheat latency
memory usage
```

Run each scenario for several seconds and ignore warm-up.

Use:

```text
median
p95
p99
```

not just a single average.

---

# 62. Benchmark Sigma separately from physics

You want to know where the time goes.

Instrument:

```text
temporal
graph mutation
layout communication
layout physics
Sigma processing
WebGL rendering
```

Then produce:

```text
timeline interaction = 42 ms

temporal       2 ms
graph          8 ms
physics       24 ms
Sigma           7 ms
misc            1 ms
```

This tells you what to optimize.

Without this breakdown, "optimization" becomes guesswork.

---

# 63. Production performance telemetry

Add a hidden developer panel showing:

```text
nodes
edges
visible labels
layout FPS
Sigma processing time
worker time
temporal seek time
graph mutation time
reheat amount
memory estimate
```

This makes real-world debugging much easier.

---

# 64. What should happen during rapid slider movement

Recommended state machine:

```text
IDLE
 │
 │ pointerdown
 ▼
SCRUBBING
 │
 │ pointermove
 ▼
COALESCED TARGET
 │
 │ requestAnimationFrame / throttle
 ▼
TEMPORAL UPDATE
 │
 │ pointerup
 ▼
COMMIT
 │
 ▼
SETTLE
 │
 ▼
IDLE
```

During `SCRUBBING`:

```text
avoid expensive labels
avoid expensive edge detail
limit layout iterations
coalesce timeline changes
```

During `SETTLE`:

```text
restore normal rendering
allow physics to relax
```

This can make the interface feel much faster without changing the underlying algorithm.

---

# 65. Sigma version strategy

As of August 2026:

- Sigma 3.0.3 is the current published npm version. citeturn890742search2
- Sigma v4 is available as a pre-release line with a substantially rewritten renderer.
- The official v4 site currently describes itself as beta, while the npm/GitHub messaging still labels the release alpha.
- The maintainer said on 16 June 2026 that v4 was effectively beta-quality, full-featured, API-stable in intent, with more bugs still expected around feature interactions. citeturn890742search0turn123785search5

### Recommendation

For a new build:

```text
prototype:
Sigma v4

production fallback:
Sigma v3
```

But make the application architecture version-agnostic.

Do not let Sigma v3/v4 API differences leak into the temporal engine.

---

# 66. Why Sigma v4 deserves the benchmark

Sigma v4's rendering architecture:

```text
WebGL
+
unified node program
+
unified edge program
+
declarative styles
+
GPU picking
+
GPU text
```

is a significant architectural improvement over the older rendering stack. citeturn199199search0turn123785search4

The v4 documentation also explicitly targets large graphs and includes large interactive examples. citeturn123785search5

Therefore the benchmark should no longer assume v3 is automatically the better production starting point.

---

# 67. Do not prematurely fork Sigma

If GPU FA2 does not support one required mutation mode efficiently:

```text
do not fork Sigma first
```

Instead isolate the problem:

```text
Sigma
   │
layout interface
   │
┌──┴─────────────────┐
│                    │
GPU FA2          Custom worker
```

Only fork the specific package responsible for physics if necessary.

---

# 68. Recommended project structure

```text
src/
  data/
    players.ts
    matches.ts
    normalize.ts

  temporal/
    index.ts
    accumulator.ts
    checkpoints.ts
    delta.ts
    pair-key.ts

  graph/
    projection.ts
    graph-state.ts

  layout/
    types.ts
    fa2-worker.ts
    fa2-gpu.ts
    d3-worker.ts
    reheating.ts
    position-store.ts

  render/
    sigma.ts
    styles.ts
    reducers.ts
    lod.ts

  timeline/
    controller.ts
    scrub-mode.ts

  benchmark/
    temporal.ts
    layout.ts
    rendering.ts

  tests/
    temporal.property.ts
    temporal.reference.ts
    graph.invariants.ts
    layout.regression.ts
```

The layout backend should be replaceable without touching the temporal engine.

---

# 69. Implementation phases

## Phase 1 — correctness core

Build:

```text
normalized data
dense IDs
sorted matches
reversible accumulator
checkpoints
Graphology projection
```

Ignore fancy rendering.

Success criterion:

```text
any timeline state is reproducible exactly
```

---

## Phase 2 — baseline visualization

Add:

```text
Sigma v3 or v4
persistent positions
basic styles
basic interaction
```

Success criterion:

```text
timeline works
graph does not rebuild
positions persist
```

---

## Phase 3 — layout benchmark

Implement adapters for:

```text
GPU FA2
stock FA2 worker
D3-force worker
```

Measure them against the same datasets.

Do not optimize the winner yet.

---

## Phase 4 — incremental physics

If stock/GPU FA2 fails the dynamic benchmark:

```text
implement custom incremental FA2
```

Use the existing FA2 force model but change its topology/weight update lifecycle.

---

## Phase 5 — production LOD

Implement:

```text
label LOD
edge LOD
interaction LOD
scrub mode
reheat policy
```

---

## Phase 6 — scale testing

Run:

```text
1k
3k
10k
20k
50k
```

until the chosen architecture stops meeting UX targets.

---

# 70. Minimum viable implementation

The first production-quality prototype should have exactly these properties:

```text
[✓] immutable match data
[✓] dense player IDs
[✓] sorted timeline
[✓] reversible accumulator
[✓] checkpoints
[✓] persistent Graphology projection
[✓] persistent layout positions
[✓] worker-based temporal computation
[✓] layout adapter interface
[✓] Sigma rendering
[✓] controlled reheating
[✓] scrub coalescing
[✓] LOD
[✓] property-based temporal tests
[✓] performance instrumentation
```

Do not add community detection, minute-level overlap, WebGPU physics, or custom hash tables until the core system is measured.

---

# 71. What to remove from the original implementation plan

Remove or change these assumptions:

### Remove

```text
"Keep one stock Graphology FA2 worker running forever."
```

Reason:

The worker implementation currently respawns on node/edge topology mutations. citeturn278327view0

### Remove

```text
"Changing Graphology edge weight automatically changes the FA2 worker."
```

Reason:

The current worker supervisor does not listen for edge-attribute update events. citeturn278327view0

### Replace

```text
"same-day batching"
```

with:

```text
"timeline-resolution batching"
```

### Replace

```text
"strong mental-map preservation"
```

with:

```text
"persistent initial positions + controlled physical relaxation"
```

### Replace

```text
"graph is the source of truth"
```

with:

```text
"immutable data + temporal accumulator are the source of truth"
```

Graphology is a projection.

---

# 72. What to keep from the original document

These ideas were good and should remain:

```text
✓ immutable match data
✓ reversible +1 / -1 accumulation
✓ cumulative graph model
✓ position persistence
✓ Graphology/Sigma separation
✓ batching temporal updates
✓ Barnes-Hut for repulsion
✓ separate analytical and visual weights
✓ checkpoint concept
✓ concern about graph size
```

The major change is that the layout engine becomes an independent subsystem.

---

# 73. Final recommended architecture

```text
┌───────────────────────────────────────────────────────────┐
│                    IMMUTABLE DATA                         │
│                                                           │
│   players        matches        metadata                  │
└──────────────────────────┬────────────────────────────────┘
                           │
                           ▼
┌───────────────────────────────────────────────────────────┐
│                    TEMPORAL ENGINE                        │
│                                                           │
│ sorted match index                                        │
│ cursor                                                    │
│ playerCounts                                              │
│ pairCounts                                                │
│ checkpoints                                               │
│ seek/replay                                               │
└──────────────────────────┬────────────────────────────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │ Temporal Delta  │
                  └────────┬────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
┌─────────────────────────┐   ┌─────────────────────────────┐
│     GRAPH PROJECTION    │   │       LAYOUT SUBSYSTEM      │
│                         │   │                             │
│ Graphology              │   │ persistent x/y/vx/vy        │
│ active nodes             │   │ incremental topology       │
│ active edges             │   │ controlled reheat          │
│ analytical counts        │   │                             │
└────────────┬────────────┘   │ GPU FA2 / custom FA2 / D3   │
             │                └──────────────┬──────────────┘
             │                               │
             └──────────────┬────────────────┘
                            ▼
                 ┌─────────────────────────┐
                 │         SIGMA            │
                 │                          │
                 │ WebGL rendering          │
                 │ LOD                      │
                 │ interaction state        │
                 │ labels                   │
                 └────────────┬─────────────┘
                              │
                              ▼
                           USER
```

---

# 74. Performance priorities, ranked

If engineering time is limited, implement these in this order:

| Priority | Change | Expected impact |
|---|---|---|
| 1 | Never rebuild historical state per frame | Very high |
| 2 | Persistent layout positions | Very high |
| 3 | Incremental temporal delta | Very high |
| 4 | Avoid layout restarts | Very high |
| 5 | Coalesce timeline updates | Very high |
| 6 | Worker-based physics | High |
| 7 | Typed-array runtime representation | High |
| 8 | LOD | High |
| 9 | Reheat based on delta magnitude | High |
| 10 | GPU FA2 benchmark | Potentially very high |
| 11 | Packed pair hash table | Medium |
| 12 | WebGPU custom physics | Potentially very high, later |

---

# 75. Acceptance criteria

The system should not be considered finished until it satisfies:

## Correctness

```text
forward and backward temporal navigation are exact
random seeks match the reference implementation
graph counts match accumulator counts
```

## Responsiveness

```text
normal timeline transitions feel immediate
rapid scrubbing does not freeze the UI
layout continues without visible restarts
```

## Stability

```text
existing players retain spatial neighborhoods where reasonable
small temporal changes do not cause global rearrangement
large structural changes still produce legitimate reorganization
```

## Scalability

```text
3,000-node graph remains comfortably interactive
10,000-node graph remains usable
larger graphs degrade gracefully through LOD
```

## Maintainability

```text
temporal engine independent of Sigma
layout engine replaceable
rendering engine replaceable
data representation testable independently
```

---

# 76. Final recommendation

The system should be implemented as an **incremental temporal graph engine with a persistent spatial simulation**, not as a timeline that repeatedly reconstructs and lays out a graph.

The practical design is:

```text
immutable history
      ↓
reversible accumulator
      ↓
temporal delta
      ↓
persistent Graphology projection
      +
persistent layout state
      ↓
incremental layout
      ↓
Sigma/WebGL
```

For the layout layer, benchmark **Sigma v4 GPU ForceAtlas2 first**, because the current v4 stack has a GPU FA2 implementation and a modern WebGL architecture designed for large graphs. citeturn123785search0turn123785search4

If its dynamic-update behavior does not meet the requirements, use a **custom incremental FA2 worker** rather than trying to force the stock Graphology worker into a role it was not designed to fill. The stock worker's current restart behavior is the clearest architectural limitation in the original design. citeturn278327view0

Use D3-force as the third benchmark candidate because its mutable simulation model and Barnes-Hut many-body force make it a strong dynamic-graph baseline. citeturn496987search5

The key optimization is therefore not a micro-optimization of pair counting.

It is this:

> **Never throw away useful state.**

Reuse:

```text
historical analytical state
graph topology
node positions
velocity state
GPU buffers
worker state
```

and change only what the temporal delta actually requires.

That is the architecture most likely to make the system feel continuously alive while remaining efficient as the graph grows.

---

# Appendix A — Reference pseudocode

```ts
class TemporalEngine {
    private cursor = 0;
    private playerCounts: Uint32Array;
    private pairCounts: PairCounter;
    private checkpoints: Checkpoint[];

    seek(target: number): TemporalDelta {
        const distance = target - this.cursor;

        if (Math.abs(distance) <= 256) {
            return this.walk(distance);
        }

        const checkpoint = this.findCheckpoint(target);

        this.restore(checkpoint);
        const delta = this.replayTo(target);

        return delta;
    }

    private walk(distance: number): TemporalDelta {
        const delta = new DeltaBuilder();

        const direction = distance >= 0 ? 1 : -1;
        const count = Math.abs(distance);

        for (let i = 0; i < count; i++) {
            const matchIndex =
                direction > 0
                    ? this.cursor
                    : this.cursor - 1;

            this.applyMatch(
                this.matches[matchIndex],
                direction,
                delta
            );

            this.cursor += direction;
        }

        return delta.finish();
    }
}
```

---

# Appendix B — Layout adapter

```ts
interface LayoutEngine {
    initialize(
        nodes: NodeArray,
        edges: EdgeArray,
        state: LayoutState
    ): void;

    applyDelta(delta: LayoutDelta): void;

    reheat(amount: number): void;

    start(): void;

    stop(): void;

    positions(): Float32Array;

    destroy(): void;
}
```

---

# Appendix C — Position store

```ts
class PositionStore {
    x: Float32Array;
    y: Float32Array;

    constructor(capacity: number) {
        this.x = new Float32Array(capacity);
        this.y = new Float32Array(capacity);
    }

    ensureCapacity(capacity: number) {
        if (capacity <= this.x.length) return;

        const x = new Float32Array(capacity);
        const y = new Float32Array(capacity);

        x.set(this.x);
        y.set(this.y);

        this.x = x;
        this.y = y;
    }
}
```

---

# Appendix D — Benchmark matrix

```text
                     1k     3k     10k     20k+
-------------------------------------------------
GPU FA2               ✓      ✓       ✓       ?
Custom FA2            ✓      ✓       ✓       ✓
D3-force              ✓      ✓       ?       ?
Sigma rendering       ✓      ✓       ✓       ?
CPU temporal          ✓      ✓       ✓       ✓
Memory                ✓      ✓       ✓       ?
```

The question marks must be resolved by measurement.

Do not extrapolate them from marketing claims.

---

# Appendix E — Source basis

## User-provided design

The original document already identifies the strongest parts of the architecture as immutable match data, reversible timeline state, Graphology as a projection, persistent positions, and batched updates. It also identifies the central concerns around persistent FA2, dynamic edge weights, temporal-model ambiguity, scalability, and visual stability. fileciteturn0file0L5-L17

## Current implementation research

### Sigma.js

- Sigma npm: https://www.npmjs.com/package/sigma
- Sigma v4 documentation: https://v4.sigmajs.org/
- Sigma v4 lifecycle: https://v4.sigmajs.org/concepts/lifecycle/
- Sigma v4 rendering: https://v4.sigmajs.org/concepts/rendering/
- Sigma v4 GPU FA2 example: https://v4.sigmajs.org/embed/core/fa2-gpu-layout/
- Sigma v4 GPU FA2 dataset example: https://v4.sigmajs.org/embed/core/fa2-gpu-datasets/
- Sigma v4 migration guide: https://v4.sigmajs.org/how-to/technical/migration-v3-v4/
- Sigma v4 status discussion, April/June 2026: https://github.com/jacomyal/sigma.js/discussions/1539

### Graphology

- Graphology: https://www.npmjs.com/package/graphology
- Graphology performance tips: https://graphology.github.io/performance-tips.html
- Graphology attributes: https://graphology.github.io/attributes.html
- Graphology events: https://graphology.github.io/events.html
- Graphology FA2 documentation: https://graphology.github.io/standard-library/layout-forceatlas2.html
- Graphology FA2 package: https://www.npmjs.com/package/graphology-layout-forceatlas2
- Current FA2 worker source inspected through UNPKG: https://app.unpkg.com/graphology-layout-forceatlas2@0.10.1/files/worker.js

### ForceAtlas2

- Jacomy et al., *ForceAtlas2, a Continuous Graph Layout Algorithm for Handy Network Visualization Designed for the Gephi Software*, PLOS ONE: https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0098679

### D3-force

- D3 force simulation: https://d3js.org/d3-force/simulation
- D3 link force: https://d3js.org/d3-force/link
- D3 many-body force: https://d3js.org/d3-force/many-body

### Browser concurrency

- MDN Web Workers: https://developer.mozilla.org/docs/Web/API/Web_Workers_API/Using_web_workers
- MDN transferable objects: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
- MDN Worker.postMessage: https://developer.mozilla.org/en-US/docs/Web/API/Worker/postMessage
- MDN OffscreenCanvas: https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
- MDN WebGPU API: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API

### Dynamic graph visualization

- *Online force-directed algorithms for visualization of dynamic graphs*: https://www.sciencedirect.com/science/article/pii/S0020025520312354
- *The "Map" in the mental map: Experimental results in dynamic graph drawing*: https://www.sciencedirect.com/science/article/pii/S107158191300102X

---

# Appendix F — Current stack snapshot

As of 17 August 2026, the externally verified stack is approximately:

```text
Sigma 3.0.3              current published npm line
Sigma v4                 pre-release / beta-quality-in-practice
Graphology 0.26.0        current published npm line
Graphology FA2 0.10.1    old package; do not treat its worker as dynamic
GPU FA2                   available in Sigma v4
WebGPU                    promising but not universal baseline
OffscreenCanvas           broadly available
Transferable ArrayBuffer  broadly available
```

The Sigma maintainer's June 2026 comment is particularly important: v4 was described as effectively beta despite the alpha label, with the API expected not to move, but with additional bugs still possible. citeturn890742search0

---

## One-sentence design rule

**Keep the data, accumulator, graph projection, and physical layout alive; only apply the smallest exact delta required to move from one temporal state to another.**
