## MODIFIED Requirements

### Requirement: Graphology is a projection, not the database
The visual scene and any Graphology graph SHALL be reproducible at any timeline position from the temporal accumulator and scene policy. Neither SHALL be the authoritative store of temporal state.

#### Scenario: Rebuild matches accumulator state
- **WHEN** the visual scene is discarded and rebuilt by seeking from empty to time T
- **THEN** the resulting active membership and edge facts are identical to having applied each match incrementally up to T

## REMOVED Requirements

### Requirement: Active graph holds only current topology
**Reason**: Persistent visual node slots are required for stable, Obsidian-like enter and leave transitions.
**Migration**: Treat current temporal membership as scene visibility targets instead of Graphology topology.

### Requirement: Deltas mutate the active graph in place
**Reason**: Temporal deltas now patch a persistent scene rather than a renderer-facing active topology graph.
**Migration**: Apply deltas through the scene-projection boundary and render only dirty visual ranges.

### Requirement: Position cache preserves spatial memory
**Reason**: Persistent node slots and continuously streamed layout positions preserve spatial memory without remove-and-readd caching.
**Migration**: Use the persistent node scene's position stream for returning players.

### Requirement: New nodes initialize near teammates
**Reason**: Entering nodes already have positions from the all-time continuously running layout.
**Migration**: Animate a node at its current layout position rather than deriving an insertion position from active teammates.

## ADDED Requirements

### Requirement: Temporal deltas patch a persistent visual scene
The projection SHALL transform each temporal delta into visual-membership, edge-detail, and display-attribute patches without rebuilding the persistent node scene.

#### Scenario: Reversible seek patches visual membership
- **WHEN** a backward seek causes a player count to cross from one to zero
- **THEN** the projection emits a visual leave patch for that player's persistent scene slot
