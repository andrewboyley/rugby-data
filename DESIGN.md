# Rugby Composition Predictor Design Contract

This is a contract for the existing Svelte 5 application. Preserve its dense,
instrument-panel character: Tailwind utility layout, daisyUI fieldsets,
buttons, badges, ranges, checkboxes, and collapse patterns; compact labels;
and `font-mono` for numbers, counters, dates, and telemetry. Sigma owns the
graph surface. Do not introduce a new visual system, custom decoration, or
production styling outside these patterns.

## 1. Named Regions and States

### `/test`, Auto-tune bench

- **Graph surface**: generated graph, grid, trails, and layout state.
- **Controls**: graph generation, layout controls, parameter controls, and
  the Auto-tune control.
- **Live View**: the continuous live environment, metrics chart, and current
  status. It is separate from trial evaluation.
- **Auto-tune diagnostics**: candidate evaluation status, calibration progress,
  scored trials, recent trial scores, and strict-best updates.
- **Status vocabulary**: `Ready`, `Running`, `Stopped`, `Calibrating`,
  `Evaluating candidate settings`, and `Scored trials`. Status must describe
  what is true now, not imply progress that has not happened.
- **Default diagnostics** show the current run state, calibration state, trial
  count, and latest useful metrics. **Advanced diagnostics** may disclose
  episode details, reward inputs, observation fields, and optimizer history,
  but stay behind progressive disclosure.
- **Reset** is safe and explicit: stop queued work, restore the current policy
  to its initial state, restore the live graph's initial positions and metrics,
  and leave unrelated graph-generation inputs unchanged. Never reset silently
  while a user is interacting with the bench.

**Laws of UX:** Hick's Law supports progressive disclosure and a small default
decision set. Jakob's Law preserves the established compact test-bench grammar.
Doherty Threshold requires live status and metrics to update while work runs.
Jakob Nielsen's visibility-of-system-status heuristic governs the status
vocabulary. Peak-End Rule makes the reset result and strict-best result clear.

### `/`, temporal graph

- **Graph region**: Sigma graph with optional grid, trails, auto-fit, and
  selection/focus state.
- **Timeline region**: date histogram, start/end range handles, play/pause,
  speed, and the current `Playing: date → date` or `Filter: date → date`
  feedback line.
- Keyboard timeline controls must expose the same range and playback actions
  as pointer input. Arrow keys move the focused handle by one available date;
  Home/End move it to the first/last date; Space toggles play/pause; Escape
  stops playback without changing the selected range.
- Every seek, range change, play, pause, and year filter must produce visible
  feedback and update an appropriate live status. Playback stops when a filter
  changes or the range is exhausted.

**Laws of UX:** Fitts's Law governs large, reachable range handles and primary
playback controls. Serial Position Effect keeps play/pause, range, and current
date feedback as the primary timeline actions. Doherty Threshold requires
feedback during seeking and playback. Peak-End Rule requires a clear final
date when playback ends.

## 2. Accessibility and Responsive Rules

- Use semantic buttons, labels, fieldsets, legends, and headings already used
  by the application. Every control has an accessible name and a visible
  focus state. Never use a clickable `div` where a button or range control is
  appropriate.
- Keep focus on the initiating control after reset, toggle, filter, and
  disclosure changes. Do not steal focus for telemetry updates.
- Use `aria-live="polite"` for status, calibration, trial, playback, and seek
  feedback. Do not put high-frequency chart samples or every animation frame
  into a live region.
- Keep graph and trail canvases pointer-inert where they are overlays. Graph
  selection must have an equivalent accessible path through the surrounding
  controls or test seam.
- Primary touch targets, including timeline handles and play/pause, must be
  comfortably tappable without precision dragging. Preserve the existing
  touch drag behavior and prevent page scrolling only while a handle is being
  dragged.
- Preserve the existing responsive contract: the `/test` bench may scroll
  inside its root, the graph keeps its usable minimum size, and controls wrap
  rather than collapse into an unrelated redesign. At narrow widths, keep
  primary actions and status visible before advanced diagnostics.
- Respect `prefers-reduced-motion`: retain state and feedback, but remove
  non-essential animation.

**Laws of UX:** Fitts's Law governs touch target size. Law of Proximity groups
labels with their controls and default diagnostics with their current status.
Jakob's Law favors native control semantics and the application's existing
daisyUI affordances. Tesler's Law requires the interaction complexity to remain
visible and understandable rather than hidden in inaccessible automation.

## 3. Transparent RL Observability

The UI must make the RL loop provable without exposing algorithm constants as
controls. A testable status view must distinguish:

1. environment reset and episode start;
2. calibration, where rewards are not yet scored;
3. candidate evaluation and live-view independence;
4. finite completed episode reward;
5. strict-best acceptance, including the accepted reward and settings change;
6. reset or stop, including whether the live graph was restored.

Use structured values, not screenshot-only assertions. The seam must expose
stable `data-testid` hooks for the Auto-tune toggle, episode length, and
Auto-tune state, retaining the existing IDs `autotune-toggle`,
`episode-length`, and `autotune-state`. The graph seam must retain
`main-graph` and its structured attributes: `data-grid-enabled`,
`data-trails-enabled`, `data-layout-worker-id`, `data-layout-reloads`,
`data-node-count`, and `data-edge-count`.

Browser tests should assert state transitions and structured values: no reward
before calibration, trial progress after calibration, strict-best replacement
only for a finite strictly higher reward, live graph continuity while trials
run, and safe reset semantics. Screenshots may verify rendering, but cannot be
the only proof of RL behavior.

**Laws of UX:** Visibility of System Status makes each RL phase explicit.
Jakob's Law supports predictable controls and familiar status presentation.
Miller's Law limits the default diagnostic summary; advanced details are
available without forcing every value into the primary view. Doherty Threshold
requires observable progress while evaluation is active.

## 4. Test Seam and Non-Goals

- Prefer stable role, label, and `data-testid` queries over CSS selectors,
  generated class names, canvas pixels, or implementation-private state.
- Keep structured browser attributes deterministic and sufficient to verify
  graph identity, topology reloads, node/edge counts, grid/trails state, and
  worker continuity.
- Do not add controls for algorithm constants or hidden ForceAtlas2/RL
  implementation details. User-facing controls describe the authorized test
  workflow only.
- Do not redesign the application, replace daisyUI/Tailwind patterns, change
  the Sigma graph language, or introduce a new navigation or dashboard model.

**Laws of UX:** Jakob's Law protects the current visual and interaction model.
Fitts's Law keeps the test seam aligned with real user controls rather than
hidden debug affordances. Law of Proximity keeps diagnostics attached to the
workflow they explain. The Zeigarnik Effect supports persistent, readable
status so unfinished evaluation is not mistaken for completion.
