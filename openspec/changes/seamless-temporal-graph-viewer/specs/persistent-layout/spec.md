## MODIFIED Requirements

### Requirement: One persistent FA2 worker for the session
The system SHALL create exactly one continuously running FA2 worker bound to a private all-time layout topology for the viewer session. Timeline changes SHALL NOT create, kill, replace, or reload the worker's topology. The worker SHALL publish position snapshots for the visual scene to consume.

#### Scenario: Timeline change does not restart layout
- **WHEN** the timeline cursor moves forward past 50 matches
- **THEN** the same FA2 worker continues to produce layout positions without a topology reload or worker replacement

### Requirement: Layout reacts to topology deltas
The running simulation SHALL model the all-time player and co-occurrence topology for the session. Timeline membership changes SHALL affect visual presence but SHALL NOT alter the worker's force topology.

#### Scenario: Player enters the timeline
- **WHEN** a player becomes temporally active for the first time
- **THEN** the player enters at the current position produced by the all-time layout without a force-topology mutation

#### Scenario: New edges perturb existing layout
- **WHEN** an all-time co-occurrence edge is present in the initialized layout topology
- **THEN** the continuous FA2 simulation adjusts its incident nodes over subsequent ticks without timeline seeks mutating the topology

### Requirement: Layout never auto-terminates on timeline change
The system SHALL keep the worker running throughout the viewer session, including while paused or scrubbing, and SHALL stop it only on explicit disposal.

#### Scenario: Continuous motion while paused
- **WHEN** playback is paused and the viewer remains open
- **THEN** the worker continues to publish evolving layout positions until the viewer is disposed

#### Scenario: Continuous motion during playback
- **WHEN** the user holds play and the timeline advances repeatedly
- **THEN** the worker remains running throughout playback and is not stopped between frames

## REMOVED Requirements

### Requirement: Weighted attraction reflects matchCount
**Reason**: All-time layout weights are derived when the stable layout topology is initialized rather than changed by timeline deltas.
**Migration**: Use the documented all-time layout weight policy when constructing the worker topology.
