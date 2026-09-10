## 1. Baseline And Sigma v4 Compatibility

- [x] 1.1 Capture production-shaped browser traces for load, pan, selection, rapid scrub, playback, and continuous layout; record frame-time and long-task baselines.
- [x] 1.2 Add a Sigma v4 alpha compatibility spike that pins a compatible `sigma` and `@sigma/*` package set and verifies primitives, styles, custom state, depth layers, custom WebGL layers, selection, cleanup, and browser builds.
- [x] 1.3 Implement and test the baseline renderer fallback behind the same renderer port; select the adapter through a verified feature policy.

## 2. Temporal Scene Domain

- [x] 2.1 Define library-independent scene records, typed-array slot storage, scene patches, dirty ranges, and renderer/layout ports.
- [x] 2.2 Implement the persistent node scene with stable slots for players and coaches, visual target state, interactivity state, and active transition sets.
- [x] 2.3 Implement temporal-delta projection into node membership, filter, selection, match, and edge-detail patches without changing temporal-index truth.
- [ ] 2.4 Implement transition advancement with latest-target replacement and verify node enter, leave, return, and non-interactive exit behavior.
- [ ] 2.5 Implement ranked bounded edge projection with reserved selected-player, partner, and match edges; verify full temporal edge facts remain queryable.

## 3. Continuous Layout Position Stream

- [ ] 3.1 Build a private all-time layout topology with documented all-time edge weight initialization and one continuously running FA2 worker.
- [ ] 3.2 Replace timeline-triggered FA2 topology reload behavior with indexed transferable position snapshots and double-buffer ownership.
- [ ] 3.3 Implement scene-side previous/current position interpolation and back-pressure snapshot publication without stopping the worker.
- [ ] 3.4 Add tests proving timeline seeks do not mutate layout topology, replace the worker, or reset player positions.

## 4. Frame-Owned Rendering

- [ ] 4.1 Implement `RenderScheduler` as the only render owner, with latest-wins seek commands and dirty flags for timeline, scene, layout, camera, and overlays.
- [ ] 4.2 Refactor `TimelineController` and `TemporalGraph` so they publish commands or snapshots instead of directly calling `Sigma.refresh()`.
- [ ] 4.3 Implement `SigmaV4SceneRenderer` with declarative primitives/styles, partial scheduled refreshes, movement detail reduction, and renderer-independent scene patch inputs.
- [ ] 4.4 Implement the bounded edge renderer using the verified Sigma v4 primitive or custom WebGL-layer path; update only dirty edge ranges.
- [ ] 4.5 Remove temporal display computation from hot Sigma reducers and move visual state calculation into scene projection.

## 5. Integration And Verification

- [ ] 5.1 Wire Svelte timeline, filters, search selection, match overlays, camera, and accessibility state to the viewer-session facade without recreating renderer or layout objects.
- [ ] 5.2 Add unit tests for scene projection, transition timing, edge priority, latest-wins commands, layout snapshots, and adapter fallback selection.
- [ ] 5.3 Add browser tests for Obsidian-like node entry/exit, stable position reuse, rapid scrub coalescing, selection during transitions, camera movement detail reduction, and persistent continuous layout.
- [ ] 5.4 Establish and enforce production-shaped frame-time, long-task, renderer-refresh, edge-budget, and worker-identity budgets in browser tests.
- [ ] 5.5 Run `just check-web`, `just lint-web`, the focused browser suite, and the complete web test suite; inspect production traces before enabling the new viewer path.
