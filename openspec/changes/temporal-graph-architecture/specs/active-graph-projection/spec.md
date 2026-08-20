## Purpose

Defines how the currently-active subset of the temporal graph is projected into a live Graphology graph that the layout and renderer consume, including spatial continuity and weight semantics.

## ADDED Requirements

### Requirement: Active graph holds only current topology
The active Graphology graph SHALL contain only nodes and edges whose current accumulator count is greater than zero. It SHALL NOT pre-load the full historical graph.

#### Scenario: Inactive nodes absent
- **WHEN** a player's `playerCounts` entry is zero
- **THEN** that player node is absent from the active graph

### Requirement: Deltas mutate the active graph in place
The projection SHALL apply a `Delta` by adding/removing nodes and edges and updating edge attributes, without rebuilding the entire graph. It SHALL perform all mutations for one delta before yielding to the renderer.

#### Scenario: Batch applied atomically per frame
- **WHEN** a delta contains 5 addNodes, 12 addEdges, and 3 updateEdges
- **THEN** all 20 graph mutations occur from the single delta and the renderer is updated once, not 20 times

### Requirement: Position cache preserves spatial memory
The projection SHALL maintain a position cache keyed by node id. On node removal it SHALL store the node's last `x`/`y`; on node (re)addition it SHALL reuse the cached position when available.

#### Scenario: Player returns near last position
- **WHEN** a player disappears (count → 0) at position (px,py) and later reappears (count 0 → 1)
- **THEN** the re-added node is initialized at approximately (px,py) rather than at the origin or randomly

### Requirement: New nodes initialize near teammates
When a node is added and has active neighbors in the current match, its initial position SHALL be the average of those neighbors' positions plus small jitter. If no active neighbors exist, it MAY use a cached or seeded position.

#### Scenario: New node near existing teammates
- **WHEN** a node is added with three active teammates at known positions
- **THEN** the node's initial position is within a small jitter radius of the teammates' centroid

### Requirement: Separate matchCount, layout weight, and visual size
Each edge SHALL carry three distinct values: `matchCount` (raw co-occurrence count, for tooltips/filtering), `weight` (layout weight, derived e.g. `sqrt(matchCount)`, for FA2), and `size` (visual thickness, derived e.g. `log2(matchCount+1)`, for rendering). Changing `matchCount` SHALL update the other two.

#### Scenario: Heavy edge does not dominate physics
- **WHEN** an edge has `matchCount` = 100 and another has `matchCount` = 1
- **THEN** the layout weight ratio is `sqrt(100)/sqrt(1)` = 10, not 100, while `matchCount` remains 100 for display

### Requirement: Graphology is a projection, not the database
The active graph SHALL be reproducible at any timeline position by replaying the accumulator from empty to that cursor. The graph SHALL NOT be the authoritative store of temporal state.

#### Scenario: Rebuild matches accumulator state
- **WHEN** the active graph is discarded and rebuilt by seeking from empty to time T
- **THEN** the resulting node/edge set is identical to having applied each match incrementally up to T
