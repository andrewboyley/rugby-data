## Purpose

Provides the graph viewer's header filter controls: minimum-threshold sliders for edge weight and node degree, a View menu for presentation options, and a mobile bottom sheet that mirrors the desktop controls.

## Requirements

### Requirement: Min-threshold sliders
The control area SHALL expose two native range sliders: **shared matches** (edge weight) and **degree** (node connectivity). Each slider sets a single minimum threshold; the graph SHALL show only elements at or above the threshold. The default is the "any" state (shared matches = 1, degree = 1). Slider bounds SHALL derive from the data (shared matches ≤ maximum observed edge weight, degree ≤ maximum observed degree). The slider value SHALL update while dragging; the graph filter SHALL apply on release.

#### Scenario: default state shows everything
- **GIVEN** graph data is loaded and no thresholds have been changed
- **WHEN** the page renders
- **THEN** both sliders read 1 ("any") and the graph shows all qualifying nodes and edges

#### Scenario: threshold applies on release
- **GIVEN** the shared matches slider is at 1
- **WHEN** the user drags it to 5 and releases
- **THEN** the graph shows only edges with weight ≥ 5 and the slider reads 5
- **AND** while the user is still dragging, the slider number updates but the graph has not applied the new value

#### Scenario: degree threshold
- **GIVEN** the degree slider is at 1
- **WHEN** the user drags it to 10 and releases
- **THEN** the graph shows only nodes with degree ≥ 10

#### Scenario: bounds come from data
- **GIVEN** the maximum observed edge weight is 40
- **WHEN** the user inspects the shared matches slider
- **THEN** its maximum is 40 and it cannot be set above 40

### Requirement: View dropdown
A "View" menu SHALL group presentation options: **node colour** (jersey / team / neutral), **edge colour** (shared-match count / avg win rate), **edge alpha** (range within 0.05–1), **show coaches**, and **show metaballs** (both toggles). Controls SHALL reflect the current state and update the graph when changed.

#### Scenario: change node colour
- **GIVEN** the View menu is open
- **WHEN** the user picks "Team"
- **THEN** graph node colours switch to team colours and the select shows "Team"

#### Scenario: toggle coaches
- **GIVEN** the View menu is open
- **WHEN** the user toggles "Show coaches" on
- **THEN** coach nodes appear in the graph; toggling off removes them

#### Scenario: constrain edge alpha
- **GIVEN** the edge alpha control is present
- **WHEN** the user drags it
- **THEN** the value stays within 0.05–1 inclusive

### Requirement: No date control
The filter bar SHALL expose no date control; the date range SHALL be owned exclusively by the timeline.

#### Scenario: date absent from filter bar
- **GIVEN** the control area renders
- **THEN** no date input or date slider is present anywhere in the filter bar

### Requirement: Responsive layout
Desktop SHALL render the controls in the header. On narrow viewports a filter button SHALL open a bottom sheet containing the same controls; changes inside the sheet SHALL apply identically to the graph. The sheet SHALL be dismissible and SHALL NOT block interaction when closed.

#### Scenario: mobile bottom sheet mirrors desktop
- **GIVEN** a narrow viewport
- **WHEN** the user opens the filter sheet and moves the degree threshold
- **THEN** the graph updates exactly as it would from the desktop control, and the sheet can be closed without reverting the update

#### Scenario: desktop header controls
- **GIVEN** a wide viewport
- **WHEN** the page renders
- **THEN** the filter controls appear directly in the header row

### Requirement: Filter model
The graph subset SHALL derive from exactly two thresholds (shared matches, degree) plus the date range and match-context selection; no maximum-band values SHALL exist. Header statistics SHALL always reflect the applied filter state.

#### Scenario: statistics track filters
- **GIVEN** filters are modified
- **WHEN** any threshold changes
- **THEN** the header node/edge counts match the visible subset