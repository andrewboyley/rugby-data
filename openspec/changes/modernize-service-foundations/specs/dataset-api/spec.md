## Purpose

Expose the generated versioned rugby dataset through a local, read-only HTTP interface without creating a second consumer contract.

## ADDED Requirements

### Requirement: Serve the dataset contract
The service SHALL serve the current local schema-versioned dataset artifact without exposing raw upstream cache content or making upstream requests.

#### Scenario: Retrieve full dataset
- **WHEN** a client requests the dataset endpoint
- **THEN** the service SHALL return the complete versioned dataset contract as JSON

#### Scenario: Missing dataset on startup
- **WHEN** the service starts without a readable supported dataset artifact
- **THEN** startup SHALL fail without serving an empty or partial dataset

### Requirement: Serve contract fragments
The service SHALL provide read-only lookups for games and entity registries using identifiers from the dataset contract.

#### Scenario: Retrieve a known game
- **WHEN** a client requests a known event identifier
- **THEN** the service SHALL return that game's contract fragment

#### Scenario: Retrieve an unknown fragment
- **WHEN** a client requests an unknown or malformed fragment identifier
- **THEN** the service SHALL return a JSON 404 response

### Requirement: Reload atomically written artifacts
The service SHALL detect replacement dataset artifacts, publish only validated replacements, and retain the last valid artifact if a replacement is invalid.

#### Scenario: Valid artifact replacement
- **WHEN** a valid dataset artifact atomically replaces the served artifact
- **THEN** a subsequent request SHALL serve the new artifact without restarting the service

#### Scenario: Invalid artifact replacement
- **WHEN** an invalid or unsupported artifact replaces the served artifact
- **THEN** the service SHALL retain the last valid artifact for subsequent successful reads

### Requirement: Support conditional retrieval
The service SHALL include an entity tag for dataset responses and SHALL return 304 when a matching conditional request is made.

#### Scenario: Matching entity tag
- **WHEN** a client sends a matching If-None-Match value for the current dataset artifact
- **THEN** the service SHALL return 304 without a response body
