# Rugby Composition Predictor

Builds a dataset of international rugby union matches from the ESPN CORE API,
derives a player co-occurrence graph, and visualises it in the browser.

The dataset covers all international (national) teams. Match discovery
iterates each team's events per year, so any competition a national team enters
— across current or future leagues — is captured automatically.

## Commands

Requires a virtual environment with the package installed:

```sh
uv sync
.venv/bin/rugby-composition-predictor dataset   # fetch & build data/dataset.json
.venv/bin/rugby-composition-predictor graph      # build data/graph.json
```

Restrict to a single team with `--team <id>` (e.g. `--team 5` for South
Africa); omit it to fetch all international teams.

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
      "venueId": "rims:62",
      "leagueId": "rims:Tour 2016",
      "competitors": [
        {"teamId": 5, "home": true,  "score": 30, "coachId": "13193",
         "roster": [{"playerId": 144732, "jersey": 15}]},
        {"teamId": 10, "home": false, "score": 23, "coachId": "3114",
         "roster": [{"playerId": 141716, "jersey": 15}]}
      ]
    }
  ],
  "teams":  {"5": "South Africa", "10": "Argentina"},
  "players": {"144732": "Johan Goosen"},
  "venues":  {"rims:62": {"name": "Eden Park", "city": "Auckland",
                          "country": "New Zealand"},
              "espn:98000": {"name": "Teufaiva Stadium", "city": "Nuku'alofa",
                             "country": "Tonga"}},
  "leagues": {"rims:Tour 2016": {"name": "Tour 2016", "abbreviation": "Tour 2016"},
              "espn:10659": {"name": "International Test Match",
                             "abbreviation": "International Test Match"}},
  "coaches": {"13193": "Steve Hansen", "3114": "Warren Gatland"}
}
```

- `venues`: keyed by source-prefixed id (e.g. `"rims:62"`, `"espn:98000"`)
  → `{name, city, country}`. RIMS ids come from the match's `venue`, ESPN ids
  from `gameInfo.venue`.
- `leagues`: keyed by source-prefixed id (e.g. `"rims:Tour 2016"`,
  `"espn:10659"`) → `{name, abbreviation}`. RIMS ids derive from the match's
  `competition`, ESPN ids from `header.league`.
- `coaches`: keyed by player id → display name. Populated from competitor
  roster entries flagged as coach / management in the source feed.

Only complete games are kept: both competitors present, non-empty rosters,
and both scores. Roster jerseys 1-15 are starters, 16-23 bench. Each
`games[]` entry now carries `venueId` and `leagueId`, and each
`competitors[]` entry carries `coachId`.
