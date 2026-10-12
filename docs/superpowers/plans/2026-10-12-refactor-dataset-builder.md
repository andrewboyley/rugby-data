# Refactor DatasetBuilder God Class

> Status: this plan is historical. The work is complete. The result uses
> mixins, not the separate classes in the Proposed Solution section. The README
> Pipeline section lists the final files.

## Problem
The DatasetBuilder class in src/rugby_data/builder.py is a god class with:
- 711 lines across 39 methods
- High cyclomatic complexity (CCN up to 21 in _register_team_from_rims and _fetch_game)
- High nesting levels (up to 3)
- Multiple responsibilities: orchestration, API interaction, parsing, caching, progress reporting

## Goal
Refactor DatasetBuilder into smaller, focused classes with single responsibilities while preserving all existing behavior and test coverage.

## Proposed Solution
Extract the following components from DatasetBuilder:

1. **FetchOrchestrator** - Handles the overall build process flow
2. **GameFetcher** - Responsible for fetching individual games from APIs with fallback logic
3. **GameParser** - Handles parsing of game data from different sources (RIMS, ESPN site web)
4. **TeamProcessor** - Handles team-related operations (registering teams from RIMS/ESPN)
5. **CacheManager** - Handles cache interactions (marked processed, saving, etc.)
6. **ProgressReporter** - Handles progress bar updates and reporting

## Detailed Tasks

### 1. Extract GameFetcher
- Move `_fetch_one`, `_fetch_game`, `_fetch_one_with_fallback` methods
- Extract `_is_terminal_fail` logic
- Preserve retry logic and fallback behavior
- Interface: fetch_game(team_id, year) -> Game or None

### 2. Extract GameParser
- Move `_parse_game`, `_parse_competitor`, `_parse_roster` methods
- Extract `_parse_site_web_game`, `_parse_site_web_roster`
- Preserve all parsing logic for different formats
- Interface: parse_game(data, source) -> Game

### 3. Extract TeamProcessor
- Move `_register_team_from_rims`, `_register_team_from_espn` methods
- Extract team registration logic
- Interface: register_team(team_id, source) -> bool

### 4. Extract CacheManager
- Encapsulate cache interactions: mark_processed, is_processed, put, get, save
- Keep as thin wrapper if beneficial, or consider if direct cache use is acceptable

### 5. Extract ProgressReporter
- Wrap BuildListener interactions
- Handle progress bar updates
- Interface: report_progress(team_name, step), report_completion()

### 6. Refactor FetchOrchestrator (formerly DatasetBuilder)
- Orchestrates the build process using the extracted components
- Manages the ThreadPoolExecutor for parallel fetching
- Handles the main build loop and coordination
- Much reduced complexity: focused on workflow, not implementation details

## Implementation Approach
1. Write characterization tests to capture current behavior (rely on existing test suite)
2. Extract each component one by one, ensuring tests pass after each extraction
3. Update DatasetBuilder to use the new components
4. Verify all tests pass
5. Run repowise health to confirm improvement

## Files to Modify
- src/rugby_data/builder.py (will be refactored, possibly split into multiple files)
- Potential new files:
  - src/rugby_data/fetch_orchestrator.py
  - src/rugby_data/game_fetcher.py
  - src/rugby_data/game_parser.py
  - src/rugby_data/team_processor.py
  - src/rugby_data/cache_manager.py
  - src/rugby_data/progress_reporter.py

## Acceptance Criteria
- All existing tests pass (41 passed, 1 warning acceptable)
- Repowise health score for builder.py improves from 2.5/10 to at least 6.0/10
- No change in external behavior: CLI commands produce identical output
- Lines of code in builder.py reduced by at least 40%
- Cyclomatic complexity of extracted methods reduced to <= 10
