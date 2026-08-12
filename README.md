# Rugby Composition Predictor

Builds a dataset of South African international rugby matches from the ESPN
CORE API, derives a player co-occurrence graph, and visualises it in the
browser.

## Commands

Requires a virtual environment with the package installed:

```sh
uv sync
.venv/bin/rugby-composition-predictor dataset   # fetch & build data/dataset.json
.venv/bin/rugby-composition-predictor graph      # build data/graph.json
```

Both commands are resumable and idempotent. Raw API responses are cached in
`data/api_cache.json`, so re-runs are fast and do not hit the network for
already-fetched events.

## Visualisation

A Svelte app in `web/` renders the graph. Build and serve it with Vite:

```sh
just serve                            # builds dist/, previews on localhost:8787
# http://localhost:8787/
```

Or run the steps separately:

```sh
just web                              # npm ci && vite build -> dist/
cd web && npm run preview             # serves dist/ + repo data/ on :8787
```

Nodes are players (size = appearances, colour = modal jersey number), edges
connect players who shared a match (width/opacity = co-occurrence count).
Rendering and interaction use [sigma.js](https://www.sigmajs.org) on a
[graphology](https://graphology.github.io) graph, with the
ForceAtlas2 layout (`graphology-layout-forceatlas2`) running in a web worker
with stock settings. Filter by min shared matches, max degree, team or date
window; click a node to focus its teammates; use the search box to jump to a
player, or the Recenter button to zoom the view to the currently filtered
players. Team cluster labels and the jersey
colour ramp are the only custom pieces; everything else uses stock sigma
defaults.

## Layout

```
data/   dataset.json, graph.json, api_cache.json (generated)
dist/   built viewer (generated)
web/    Svelte source for the browser visualisation
src/    rugby_composition_predictor package
```

## Data model

`dataset.json`:

```json
{
  "games": [
    {
      "eventId": 281087,
      "date": "2016-08-20T15:05Z",
      "competitors": [
        {"teamId": 5, "home": true,  "score": 30,
         "roster": [{"playerId": 144732, "jersey": 15}]},
        {"teamId": 10, "home": false, "score": 23,
         "roster": [{"playerId": 141716, "jersey": 15}]}
      ]
    }
  ],
  "teams":  {"5": "South Africa", "10": "Argentina"},
  "players": {"144732": "Johan Goosen"}
}
```

Only complete games are kept: both competitors present, non-empty rosters,
and both scores. Roster jerseys 1-15 are starters, 16-23 bench.
