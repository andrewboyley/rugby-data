## Purpose

Isolate the Sigma v4 rendering integration so advanced WebGL capabilities improve the viewer without leaking pre-release library APIs into temporal domain rules.

## ADDED Requirements

### Requirement: Renderer integration is isolated
The viewer SHALL access Sigma, Graphology, and WebGL-specific APIs only through a rendering adapter boundary. Temporal timeline and projection rules SHALL exchange library-independent records or typed arrays across that boundary.

#### Scenario: Renderer replacement
- **WHEN** a renderer adapter is replaced in a test environment
- **THEN** temporal seek and scene-projection behavior remain testable without constructing a Sigma instance

### Requirement: Render changes are incremental
The rendering adapter SHALL update only scene elements affected by a scene patch whenever their spatial index does not require rebuilding. It SHALL NOT issue a full renderer refresh for a filter, selection, or visual-transition-only change.

#### Scenario: Selection changes in a dense graph
- **WHEN** a user selects a player while the graph has many historical edges
- **THEN** the adapter updates only the affected visual scene data and schedules one render

### Requirement: Camera movement reduces visual detail
The rendering adapter SHALL hide edge detail and labels while the camera is moving and SHALL restore eligible detail when movement ends.

#### Scenario: Pan a dense graph
- **WHEN** the user pans or zooms the graph camera
- **THEN** the viewer suppresses non-essential edge and label detail until camera movement ends

### Requirement: Alpha features have a compatibility fallback
The viewer SHALL verify Sigma v4 alpha compatibility with the application's supported browser test matrix before enabling advanced primitives, custom state, or custom WebGL layers in production builds. If verification fails, the viewer SHALL use a functionally equivalent adapter path without those advanced features.

#### Scenario: Alpha API regression
- **WHEN** a Sigma v4 alpha upgrade changes or breaks an advanced rendering API
- **THEN** the application continues to load the temporal viewer through the fallback adapter and reports the compatibility failure in automated checks
