## Purpose

Provide an Obsidian-like temporal graph scene where players fade and scale into or out of a continuously moving layout without renderer topology churn.

## ADDED Requirements

### Requirement: Node scene preserves all known players
The viewer SHALL retain one persistent visual node slot for every player and coach known to the loaded dataset for the lifetime of the viewer session. Timeline membership SHALL change a node's visual targets and SHALL NOT add or remove its visual node slot.

#### Scenario: Player returns after absence
- **WHEN** a player is inactive at one timeline time and later becomes active again
- **THEN** the viewer reuses that player's existing visual node slot and current layout position

### Requirement: Timeline membership animates visual presence
The viewer SHALL animate an entering node from transparent and reduced scale to its active appearance over 140 milliseconds and SHALL animate a leaving node to transparent and reduced scale over 100 milliseconds. A leaving node SHALL become non-interactive before its exit transition completes.

#### Scenario: Player appears while scrubbing
- **WHEN** a seek makes a previously inactive player active
- **THEN** the player becomes visible at its current layout position through the configured enter transition

#### Scenario: Player leaves while scrubbing
- **WHEN** a seek makes an active player inactive
- **THEN** the player cannot receive pointer selection and completes its exit transition without moving to a new initial position

### Requirement: Edge rendering is bounded and relevant
The viewer SHALL render a bounded projection of active edges selected by a detail policy. The projection SHALL always include edges for the selected player, selected partner, and selected match even when those edges exceed the ordinary detail budget.

#### Scenario: Dense timeline state
- **WHEN** the active temporal state contains more edges than the configured detail budget
- **THEN** the viewer renders a prioritized subset while retaining the full active edge state for filtering and selection

### Requirement: Scrubbing is latest-wins
The viewer SHALL apply at most the newest pending scrub target in a rendered frame and SHALL discard superseded pending scrub targets. Superseded targets SHALL NOT create queued visual transitions.

#### Scenario: Rapid slider input
- **WHEN** a user produces several timeline input events before the next animation frame
- **THEN** the viewer seeks to only the newest requested time and starts transitions only toward that state

### Requirement: Scene updates share one frame scheduler
The viewer SHALL coalesce timeline, filter, selection, and layout-snapshot changes into no more than one scene render per animation frame.

#### Scenario: Simultaneous layout and timeline updates
- **WHEN** a layout position snapshot and a timeline seek arrive before a frame is rendered
- **THEN** the viewer applies both updates and performs one render for that frame
