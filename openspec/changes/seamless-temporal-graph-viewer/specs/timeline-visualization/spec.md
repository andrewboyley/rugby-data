## MODIFIED Requirements

### Requirement: RAF loop drives timeline playback
The application SHALL use one frame-owned scheduler that processes the latest playback or scrub target, applies the resulting temporal delta and visual scene patch, advances active transitions, and renders once. The main thread SHALL NOT recompute the full graph or layout per frame.

#### Scenario: Play advances timeline each frame
- **WHEN** playback is active and 60 frames elapse
- **THEN** the timeline target advances smoothly, each frame applies only matches that crossed since the previous frame, and the viewer renders no more than once per frame

### Requirement: Timeline controls expose play/pause/scrub/speed
The UI SHALL provide controls to play, pause, scrub to a date, and adjust playback speed. Scrubbing SHALL use the latest requested date, allow reversible temporal state changes, and animate the resulting membership in the persistent visual scene.

#### Scenario: Scrub backward reverses the graph
- **WHEN** the user drags the scrubber from 2023 to 2010
- **THEN** the engine applies reverse contributions for matches between 2010 and 2023 and the viewer animates leaving players and edges toward the 2010 state

### Requirement: Static filters are overlays on temporal state
Existing filters SHALL change visual scene targets and edge detail policy without rebuilding temporal state, the persistent node scene, or the continuous layout topology.

#### Scenario: Team filter changes during playback
- **WHEN** a team filter is activated while playback is active
- **THEN** non-matching visual elements transition to the filter state without rebuilding the scene or restarting the layout worker

#### Scenario: Team filter hides non-matching nodes
- **WHEN** a team filter is active and the timeline is at time T
- **THEN** nodes and edges not belonging to that team transition to the filtered visual state without rebuilding temporal state or the persistent node scene
