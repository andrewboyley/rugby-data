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

Serve the repo root and open the viewer:

```sh
.venv/bin/python -m http.server 8787
# http://localhost:8787/web/view_graph.html
```

Nodes are players (size = appearances, colour = degree), edges connect
players who shared a match (width/opacity = co-occurrence count). Click a node
to focus its teammates; use the sliders to filter and the force-parameter
panel to tune the layout.

## Layout

```
data/   dataset.json, graph.json, api_cache.json (generated)
web/    view_graph.html (browser visualisation)
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
