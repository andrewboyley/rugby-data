## Purpose

Defines the immutable match-stream source of truth and the reversible accumulation model that lets the graph evolve forward and backward through time without reconstruction.

## ADDED Requirements

### Requirement: Dataset is the immutable temporal source
The application SHALL treat `dataset.json` (games with competitors, rosters, dates, coach IDs) as the immutable source of temporal truth. The web app SHALL load `dataset.json` directly and SHALL NOT require a separate pre-aggregated `graph.json`.

#### Scenario: Load without graph.json
- **WHEN** the web app starts and `dataset.json` is present
- **THEN** the app builds the temporal model from `dataset.json` and does not attempt to fetch `graph.json`

### Requirement: Matches are derived as a sorted immutable stream
The system SHALL transform the `games[]` arrays into a flat, time-sorted `matches[]` array, where each match carries an integer `timestamp`, a flat list of `players` (player IDs), a `teamId`, and an optional `coachId`. The stream SHALL be treated as immutable after load.

#### Scenario: Same-day teams become separate matches
- **WHEN** a game has two international competitors each with a roster
- **THEN** the engine produces two matches (one per team) sharing the same `timestamp`, each with that team's player list and coach

### Requirement: Timeline cursor supports reversible seek
The system SHALL maintain a single integer cursor over the sorted `matches[]`. A `seek(targetTime)` operation SHALL apply only the matches that crossed the cursor boundary, adding contributions when moving forward and removing them when moving backward.

#### Scenario: Forward seek applies new matches
- **WHEN** the cursor advances from time T1 to T2 (T2 > T1)
- **THEN** every match with T1 < timestamp <= T2 is applied with direction +1 and the cursor lands after the last such match

#### Scenario: Backward seek reverses contributions
- **WHEN** the cursor moves from T2 back to T1 (T1 < T2)
- **THEN** every match with T1 < timestamp <= T2 is applied with direction -1, returning the counters to their T1 state

### Requirement: Accumulator counters are reversible
The system SHALL maintain `playerCounts` and `pairCounts` maps such that applying a match with direction +1 then -1 returns both maps to their prior state. Pair counts SHALL use an order-independent key so `(a,b)` and `(b,a)` collapse to one entry.

#### Scenario: Exact reversibility
- **WHEN** match M is applied with +1 and then immediately with -1
- **THEN** `playerCounts` and `pairCounts` are byte-identical to their state before M was applied

#### Scenario: No negative counts
- **WHEN** any `applyMatch` operation would drive a count below zero
- **THEN** the system SHALL clamp/reject the operation and surface an assertion or error rather than emit a negative count

### Requirement: Delta is emitted for graph projection
Each `seek` SHALL return a batched `Delta` describing exactly which nodes crossed 0→1 (add), 1→0 (remove), which pairs crossed 0→1 (add edge), 1→0 (remove edge), and which pair counts merely changed (update edge). The delta SHALL be the only interface between the temporal engine and the graph projection.

#### Scenario: Delta describes only changed topology
- **WHEN** a seek advances past a single match adding two new players and one new pair
- **THEN** the delta contains addNodes for those two players, addEdges for that one pair, and no remove or update entries
