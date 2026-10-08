## Purpose

Provide an intentional way to replace stale local source data while retaining fast resumable cached builds by default.

## ADDED Requirements

### Requirement: Explicit upstream refresh
The dataset command SHALL provide a refresh mode that discards cached raw upstream responses and processed-event markers before discovering and fetching source data.

#### Scenario: Refresh rebuilds from upstream
- **WHEN** an operator runs the dataset command with refresh enabled
- **THEN** the generated artifact is rebuilt without reusing prior raw source responses or processed-event markers

#### Scenario: Default build remains resumable
- **WHEN** an operator runs the dataset command without refresh or reset
- **THEN** the command SHALL retain existing cache-first and processed-event resume behavior

### Requirement: Cache-only reset remains distinct
The dataset command SHALL retain a reset mode that rebuilds from cached responses without downloading upstream data, and SHALL reject simultaneous refresh and reset modes.

#### Scenario: Reset reuses local responses
- **WHEN** an operator runs the dataset command with reset enabled
- **THEN** the command SHALL reconstruct the artifact from local cached responses without upstream requests

#### Scenario: Conflicting modes are rejected
- **WHEN** an operator enables refresh and reset together
- **THEN** the command SHALL exit with a usage error before modifying local data
