## Purpose

Validate and publish the versioned rugby dataset contract while maintaining compatibility with supported historical artifact inputs.

## ADDED Requirements

### Requirement: Validate schema version 1 artifacts
The system SHALL validate schema-versioned dataset artifacts before loading, saving, or serving them and SHALL reject unsupported future schema versions.

#### Scenario: Load supported artifact
- **WHEN** a schema-version-1 dataset artifact is loaded
- **THEN** the system SHALL make its games and entity registries available under the established contract

#### Scenario: Reject unsupported schema
- **WHEN** an artifact declares an unsupported schema version
- **THEN** the system SHALL reject the artifact with a clear validation error

### Requirement: Preserve contract serialization
The system SHALL serialize generated datasets with `schemaVersion`, `generatedAt`, complete games, and all entity registries using established camelCase field names and identifier types.

#### Scenario: Save complete dataset
- **WHEN** the builder saves a dataset containing complete games and registered entities
- **THEN** the JSON artifact SHALL retain schema version 1 and established game and registry field names

### Requirement: Support unversioned migration inputs
The system SHALL continue accepting unversioned historical dataset artifacts during migration.

#### Scenario: Load unversioned artifact
- **WHEN** a dataset artifact does not declare a schema version
- **THEN** the system SHALL load it using schema-version-1 compatibility rules
