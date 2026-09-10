# Temporal Viewer Browser Baseline

Captured 2026-09-10 with Chromium through
`just test-web tests/temporal-baseline.spec.ts --reporter=line`.

The trace uses the current renderer with a 3,483-player, 300-match fixture and
records Playwright trace data plus browser `longtask` entries. These values are
a regression baseline for the seamless temporal scene work, not acceptance
budgets.

| Interaction | p95 frame interval | Maximum frame interval |
| --- | ---: | ---: |
| Load | 8,911.6 ms | 8,911.6 ms |
| Pan | 1,527.3 ms | 1,527.3 ms |
| Selection | 1,453.9 ms | 1,453.9 ms |
| Rapid scrub | 2,667.1 ms | 2,667.1 ms |
| Playback | 2,333.0 ms | 2,333.0 ms |
| Continuous layout | 1,440.6 ms | 1,440.6 ms |

- Time to visible graph: 31,843 ms.
- Long tasks: 48 entries; worst duration: 14,746 ms.
- The passing run's Playwright trace is at
  `web/test-results/temporal-baseline-captures-1d007-ed-temporal-viewer-baseline/trace.zip`.

Re-run the command above before setting budgets in task 5.4; hardware and
browser versions change the absolute timings.
