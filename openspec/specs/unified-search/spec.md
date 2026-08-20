## Purpose

A single typeahead search box that finds players, matches, and teams with grouped results and context-appropriate actions: focus a player node, open a match view, or zoom to a team.

## Requirements

### Requirement: Single search input
One search field SHALL provide typeahead over three entity kinds: **players**, **matches**, and **teams**.

#### Scenario: one input, three kinds
- **GIVEN** the search control renders
- **WHEN** the user focuses the single input
- **THEN** results from players, matches, and teams appear in one dropdown, grouped by kind

### Requirement: Grouped results
Results SHALL be grouped with visible group headers (Players / Matches / Teams). An empty query SHALL show the most recent matches and top players by appearances. A non-empty query SHALL match: player names (ranked by appearances); matches (token-based free text over date, team names/abbreviations, scores, venue, league, roster player names — every token must match, ranked by matching tokens then recency); teams (name or abbreviation, alphabetical).

#### Scenario: empty query defaults
- **GIVEN** the input is empty and focused
- **THEN** the dropdown shows most recent matches and top players by appearances, under their group headers

#### Scenario: substring player match
- **GIVEN** the user types "dupont"
- **THEN** matching player rows appear under the Players header, ranked by appearances

#### Scenario: token match search
- **GIVEN** the user types "eng 2024"
- **THEN** only matches whose searchable text contains both "eng" and "2024" appear under the Matches header

#### Scenario: team abbreviation match
- **GIVEN** the user types "fra"
- **THEN** teams whose name or abbreviation contains "fra" appear under the Teams header, alphabetically

### Requirement: Actions
Selecting a player SHALL select/focus that player node. Selecting a match SHALL open the match view. Selecting a team SHALL zoom the graph to that team. Selecting any result SHALL close the dropdown.

#### Scenario: player selection
- **GIVEN** a player row is visible
- **WHEN** the user activates it
- **THEN** the player node is selected and the dropdown closes

#### Scenario: match selection
- **GIVEN** a match row is visible
- **WHEN** the user activates it
- **THEN** the match view opens and the dropdown closes

#### Scenario: team selection
- **GIVEN** a team row is visible
- **WHEN** the user activates it
- **THEN** the graph zooms to that team and the dropdown closes

### Requirement: Result limits
Each group SHALL show a bounded number of results; matches SHALL be capped above players/teams volume.

#### Scenario: bounded groups
- **GIVEN** a query matching many entities
- **WHEN** results render
- **THEN** each group shows at most its capped number of rows

### Requirement: Selection sync
When a player is selected programmatically (e.g. from the graph), the input SHALL reflect that player's name; otherwise the input SHALL be empty when nothing is selected.

#### Scenario: input follows selection
- **GIVEN** a player is selected on the graph
- **WHEN** the input renders
- **THEN** the input shows that player's name; clearing the selection empties the input

### Requirement: Empty state
A non-empty query with no matches SHALL show an explicit "no results" message.

#### Scenario: no matches message
- **GIVEN** the user typed a query matching nothing
- **WHEN** results render
- **THEN** an explicit "no results" message is shown instead of an empty list