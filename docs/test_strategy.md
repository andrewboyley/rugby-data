# Test Strategy

**Version:** 1.2  
**Scope:** Python dataset pipeline and Svelte temporal graph viewer.

## Goals And Risks

Protect temporal correctness first: a wrong roster, date, counter, or delta produces a plausible but false graph. Then protect interactive usability, renderer lifecycle, and offline build reliability. Live ESPN/RIMS responses are integration concerns, not a prerequisite for deterministic tests.

## Test Pyramid And Ownership

| Layer | Purpose | Current coverage | Next action |
| --- | --- | --- | --- |
| Exploratory user testing | Validate questions users can answer, timeline comprehension, filters, and recovery from empty states. | Manual only. | Script representative tasks with rugby analysts before releases. |
| Python unit/model | Parse, normalize, serialize, cache, and reject incomplete games without network access. | Cache-dependent `tests/test_fetch_entities.py`; no runner or fixtures. | Add fixture-based `unittest` tests and a `just test-python` recipe. |
| Web unit/property | Check pure temporal transformations and invariants over varied deterministic inputs. | `web/tests/temporal-graph.spec.ts`; deterministic seek-sequence property added here. | Keep generators seeded and dependency-free; add malformed-dataset cases. |
| Component | Verify Timeline, filters, labels, keyboard behavior, and empty/error states in isolation. | No component-test runner. | Add Svelte component testing only when a component needs behavior that browser E2E cannot diagnose cheaply. |
| Integration | Verify timeline, accumulator, Graphology projection, and FA2 controller cooperate. | Temporal graph and layout-environment Playwright tests. | Cover controller playback timing with controllable RAF. |
| Browser E2E | Verify routing, dataset-only loading, timeline controls, controls, and rendering in Chromium. | `web/tests/*.spec.ts` via Playwright. | Run smoke tests on every PR; run full browser suite before release. |
| Visual | Catch graph/control regressions across desktop and mobile. | One rendered-camera behavior assertion; no baselines. | Add stable screenshots for Timeline open, sparse graph, and dense graph after font/GPU normalization. |
| Accessibility | Check keyboard path, names, contrast, focus, and semantic controls. | Accessible locators provide partial coverage. | Run Lighthouse/axe in CI and manually test keyboard/screen-reader journeys. |
| Performance | Keep seeks delta-based and playback responsive. | `production-measurement.spec.ts` builds a 3,483-node, 90k+-edge projection and enforces a 20s projection-seek budget. | Add browser long-task and memory trace budgets after stable CI baselines. |
| Security | Ensure untrusted dataset/API text cannot execute and browser requests stay expected. | Dataset-only request assertion. | Dependabot/lockfile audit, CSP review, schema/size limits, and hostile-string fixtures in CI. |
| Reliability | Ensure fresh checkout, missing data, cache failures, and teardown do not crash or leak workers. | Build/check commands and lifecycle coverage. | Test missing/malformed dataset UI, repeated mount/unmount, and cache-write failure fixtures. |

## OpenSpec Temporal Requirements

| Requirement | Automated evidence | Needed evidence |
| --- | --- | --- |
| Immutable dataset source; no `graph.json` | `web/tests/temporal-ui.spec.ts` asserts dataset request and no graph request. | Fixture tests for malformed/empty datasets. |
| Sorted immutable per-team stream; same-day batching | `web/tests/temporal-graph.spec.ts` timeline test. | More date/time-zone and roster-dedup fixtures. |
| Reversible cursor, counters, and topology-only deltas | Existing temporal tests plus deterministic seek-sequence property test. | Run as required PR gate. |
| In-place projection, position cache, derived edge values | Existing active-graph tests including node-set/player-count assertion. | Projection rebuild equivalence at every timeline boundary. |
| One persistent weighted Barnes-Hut worker | `temporal-graph.spec.ts` verifies message-boundary matrix reload without `stop`/`start`; browser scrub keeps the real worker identity. | Add a browser performance trace for a production export when one is committed. |
| RAF playback, scrub, speed, pause, endpoint labels, and overlays | `temporal-ui.spec.ts` uses a deterministic fixture to cover forward/backward topology, speed, pause, endpoint label, initial positions, and match/partner overlays. | Add keyboard-only interaction coverage. |
| Rollout topology parity | `temporal-graph.spec.ts` loads the committed legacy `graph.json` fixture through its declared dataset path and compares exact nodes, edge weights, and dates. | Refresh the fixture only from a reviewed legacy export. |

## End-User Acceptance Matrix

`web/tests/acceptance.spec.ts` turns the following analyst journeys into Chromium acceptance tests:

- Load the viewer, see the graph, and confirm the legacy graph endpoint is not requested.
- Open and close the timeline while keeping the graph available.
- Scrub from the first match to the last match and back again.
- Choose an empty-at-first-date or full-at-last-date starting position.
- Play, pause, change speed, and reach the final date.
- Toggle Grid, Trails, Auto-fit, and Fit graph recovery.
- Filter by team, minimum shared matches, and selected-player neighborhood.
- Use the viewer on a narrow viewport.
- Generate and reseed a test graph, reset it, and start/stop its layout.
- Start and stop Auto-tune and inspect its episode state.
- Toggle test-bench views and return to the main viewer.

The matrix is deliberately phrased as user outcomes rather than implementation details. Exploratory sessions should extend it with keyboard-only navigation, screen-reader announcements, visual comparison, malformed-data recovery, and analyst task completion before release.

## Commands And Gates

| Command | Current role |
| --- | --- |
| `just check-python` | Python type and bytecode checks. |
| `just lint-python` | Python lint with fixes; not a read-only CI lint gate. |
| `just check-web` | TypeScript and Svelte checks. |
| `just lint-web` | Web lint with fixes; not a read-only CI lint gate. |
| `just web` | Clean install and production web build. |
| `just test-web` | Chromium Playwright suite; start the dev server first with `just dev-start`. |

`tests/test_fetch_entities.py` is an ad-hoc cache-backed diagnostic, not a hermetic test command. Do not make it a CI gate until its cache dependency is replaced with committed fixtures.

## Execution

PR gate: `just check-python`, `just check-web`, `just test-web`, and `just web`. `production-measurement.spec.ts` is part of `just test-web`; it requires at least 3,000 active nodes, 90,000 active edges, and a full projection seek below 20 seconds. Release gate: add the full visual, accessibility, performance, security, and reliability checks above, then complete exploratory sessions on desktop and mobile with an analyst. Network API contract checks should be scheduled separately, cached, rate-limited, and allowed to report provider outages distinctly from product failures.
