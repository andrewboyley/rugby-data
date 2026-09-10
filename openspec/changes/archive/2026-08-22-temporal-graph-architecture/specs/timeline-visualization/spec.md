## Purpose

Defines the timeline playback controls and the animation loop that drives the reversible temporal engine, plus how existing static filters coexist with the temporal state.

## ADDED Requirements

### Requirement: RAF loop drives timeline playback
The application SHALL run a `requestAnimationFrame` loop that, each frame, computes the target playback time and calls `seek(targetTime)` on the temporal engine, then lets the renderer reflect the resulting delta. The main thread SHALL NOT recompute the full graph or layout per frame.

#### Scenario: Play advances timeline each frame
- **WHEN** playback is active and 60 frames elapse
- **THEN** the timeline target advances smoothly and each frame applies only the matches that crossed since the previous frame

### Requirement: Same-day matches are batched as one transition
When multiple matches share a timestamp (or calendar date), the engine SHALL apply them together as a single logical transition so the user does not see intermediate partial layouts for the same moment.

#### Scenario: Five matches on one date apply together
- **WHEN** the cursor crosses a date containing five matches
- **THEN** all five matches are applied within one delta and one renderer update, not five separate updates

### Requirement: Timeline controls expose play/pause/scrub/speed
The UI SHALL provide controls to play, pause, scrub to a date, and adjust playback speed. Scrubbing SHALL call `seek` to the chosen time (forward or backward) and let the persistent layout reorganize.

#### Scenario: Scrub backward reverses the graph
- **WHEN** the user drags the scrubber from 2023 to 2010
- **THEN** the engine applies -1 contributions for matches between 2010 and 2023 and the active graph shrinks to the 2010 state

### Requirement: Static filters are overlays on temporal state
Existing filters (team selection, match/partner highlight, minimum/maximum edge weight) SHALL operate as visual/interaction overlays on the active graph rather than triggering a full graph rebuild. Edge-weight filters SHALL evaluate against the live `matchCount`.

#### Scenario: Team filter hides non-matching nodes
- **WHEN** a team filter is active and the timeline is at time T
- **THEN** nodes/edges not belonging to that team are dimmed or hidden via reducers without rebuilding the active graph or restarting FA2

### Requirement: Initial load position is configurable
On first load the application SHALL start the timeline at a defined position (empty at `dateMin` building forward, or full at `dateMax` scrubbable backward) and SHALL render the corresponding active graph before the first user interaction.

#### Scenario: Start at dateMin builds forward
- **WHEN** configured to start at `dateMin`
- **THEN** the active graph begins empty and the first forward seek populates it
