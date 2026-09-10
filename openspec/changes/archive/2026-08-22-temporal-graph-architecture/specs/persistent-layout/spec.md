## Purpose

Defines the single, continuously-running ForceAtlas2 simulation that reacts to topology changes instead of being restarted per timeline position.

## ADDED Requirements

### Requirement: One persistent FA2 worker for the session
The system SHALL create exactly one FA2 worker bound to the active graph. It SHALL NOT create, kill, or replace that worker when the timeline changes. The installed `graphology-layout-forceatlas2` supervisor recreates workers on Graphology topology events, so the application SHALL remove those listeners and reload matrices on the existing worker after each batched delta; graph positions remain the seed for the next iteration.

#### Scenario: Timeline change does not restart layout
- **WHEN** the timeline cursor moves forward past 50 matches (adding nodes/edges)
- **THEN** the same FA2 worker instance receives reloaded matrices and reacts to the topology delta; no new worker is created

### Requirement: Layout reacts to topology deltas
The running simulation SHALL respond to node/edge add/remove/update events emitted by Graphology as the active graph mutates. Forces SHALL change continuously rather than snapping to a precomputed arrangement.

#### Scenario: New edges perturb existing layout
- **WHEN** a new edge is added between two existing nodes
- **THEN** the FA2 simulation adjusts the relative positions of those nodes over subsequent ticks without a full relayout

### Requirement: Barnes-Hut enabled for scalability
The FA2 worker SHALL be configured with Barnes-Hut optimization (`barnesHutOptimize: true`) and weighted mode so repulsion scales near O(n log n) and edge weights influence attraction.

#### Scenario: Weighted attraction reflects matchCount
- **WHEN** an edge's `weight` (sqrt of matchCount) increases
- **THEN** the FA2 worker's attraction along that edge strengthens proportionally on the next ticks

### Requirement: Layout never auto-terminates on timeline change
The system SHALL NOT stop the worker upon detecting settlement when the timeline is interactive. The worker MAY be stopped only on explicit disposal (e.g. component teardown).

#### Scenario: Continuous motion during playback
- **WHEN** the user holds play and the timeline advances repeatedly
- **THEN** the worker remains running throughout and is not stopped between frames
