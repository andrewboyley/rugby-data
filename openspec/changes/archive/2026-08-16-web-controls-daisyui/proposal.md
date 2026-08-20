## Why

The web viewer's controls rely on hand-rolled CSS (`app.css`, scoped `<style>` blocks, custom `.btn`/`.control`/`.dual` classes) that conflicts with the already-installed daisyUI 5 + Tailwind 4 stack, and `Controls.svelte` duplicates the same filter markup three times (mobile drawer, two desktop variants). The existing dual-thumb range sliders are custom-built and fight the native component model.

## What Changes

- Rewrite `Controls.svelte` with daisyUI + Tailwind only: single min-threshold `range` sliders (shared matches, degree), a View dropdown (node colour, edge colour, edge alpha, coaches/metaballs toggles), and a mobile bottom sheet reusing Svelte snippets — no duplicated markup, no custom slider CSS, no date controls (Timeline owns date).
- **BREAKING (internal):** Replace the Lo/Hi filter model (`minW`/`maxW`/`minD`/`maxD`) with min-only thresholds (`minW`, `minD`) across `types.ts` `FilterSet`, `lib.ts` `visibleSubset` + cache key, `App.svelte` state/reset, and `Graph.svelte` props.
- Add `UnifiedSearch.svelte`: one search input with grouped results (Players / Matches / Teams); deletes `Search.svelte`, `MatchSearch.svelte`, and the team-zoom dropdown.
- Remove dead custom CSS (`app.css`) for controls/search/mobile drawer and the conflicting `.btn`; migrate dead Tailwind utilities (`text-muted-foreground`, `bg-base-50`) to daisyUI tokens.
- Delete stray `.bak` files (`Controls.svelte.bak`, `App.svelte.bak`, `Timeline.svelte.bak`).

## Capabilities

### New Capabilities
- `filter-bar`: Header filter/control UI — min-threshold range sliders with commit-on-release, View dropdown (colour/alpha/toggles), no date control, mobile bottom sheet with shared snippets.
- `unified-search`: Single typeahead over players, matches, and teams with grouped results and context-appropriate actions (focus player / open match / zoom team).

### Modified Capabilities
<!-- None — no existing specs in openspec/specs. -->

## Impact

- `web/src/Controls.svelte` — full rewrite (daisyUI only)
- `web/src/UnifiedSearch.svelte` — new; `web/src/Search.svelte`, `web/src/MatchSearch.svelte` — deleted
- `web/src/lib.ts` (`visibleSubset`, cache key), `web/src/types.ts` (`FilterSet`), `web/src/App.svelte`, `web/src/Graph.svelte`, `web/src/Controls.svelte.d.ts`
- `web/src/app.css` — surgical removal of control/search/mobile/`.btn` rules; dead utility migration in touched components
- Deleted: `Controls.svelte.bak`, `App.svelte.bak`, `Timeline.svelte.bak`
- Verify via `just check-web`, `just lint-web`, `just web`
- Out of scope (future): histogram-backed sliders + presets, Timeline/HUD restyles, full app.css purge