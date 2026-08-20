# Rugby Composition Predictor

Builds a dataset of international rugby union matches from the ESPN CORE API,
derives a player co-occurrence graph, and visualises it in the browser.

The dataset covers all international (national) teams. Match discovery
iterates each team's events per year, so any competition a national team enters
— across current or future leagues — is captured automatically.

## Prerequisites

- [uv](https://docs.astral.sh/uv/) — Python package manager
- [just](https://github.com/casey/just) — command runner for the recipes below
- Node.js + npm — for the web viewer

## Setup

```sh
just setup          # uv sync + install web dependencies
```

Run `just --list` to see all available commands.

## Build the dataset and graph

```sh
just dataset        # fetch all international teams -> data/dataset.json
just graph          # build data/graph.json from the dataset
```

Restrict to a single team with `--team <id>` (e.g. `just dataset --team 5`
for South Africa); omit it to fetch all international teams.

Both steps are resumable and idempotent. Raw API responses are cached in
`data/api_cache.json`, so re-runs are fast and do not hit the network for
already-fetched events. If you delete `dataset.json` and want a full
re-derive, pass `--reset`: it clears the processed-event markers and rebuilds
from the cached raw responses (no re-download). To force a true re-download,
delete `data/api_cache.json` as well.

You can also run the Python package directly instead of via `just`:

```sh
.venv/bin/rugby-composition-predictor dataset
.venv/bin/rugby-composition-predictor graph
```

## Run the viewer

Build and preview the static viewer:

```sh
just serve           # builds dist/, previews on http://localhost:8787
```

For live development with hot reload, run the dev server (port 5173):

```sh
just dev-start       # start the Vite dev server
just dev-status      # show status / logs
just dev-stop        # stop it
```

The viewer reads the generated `data/graph.json` (and `data/dataset.json`)
from the repository root.

## Visualisation

A Svelte app in `web/` renders the graph. Run it with `just serve` (or
`just dev-start` for live reload — see above).

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
      "venueId": "62",
      "leagueId": "Tour 2016",
      "competitors": [
        {"teamId": 39, "home": true,  "score": 30, "coachId": "13193",
         "roster": [{"playerId": 144732, "jersey": 15}]},
        {"teamId": 40, "home": false, "score": 23, "coachId": "3114",
         "roster": [{"playerId": 141716, "jersey": 15}]}
      ]
    }
  ],
  "teams":  {"39": "South Africa", "40": "Argentina"},
  "players": {"144732": "Johan Goosen"},
  "venues":  {"62": {"name": "Eden Park", "city": "Auckland",
                     "country": "New Zealand"},
              "98000": {"name": "Teufaiva Stadium", "city": "Nuku'alofa",
                        "country": "Tonga"}},
  "leagues": {"Tour 2016": {"name": "Tour 2016", "abbreviation": "Tour 2016"},
              "10659": {"name": "International Test Match",
                        "abbreviation": "International Test Match"}},
  "coaches": {"13193": "Steve Hansen", "3114": "Warren Gatland"}
}
```

All entity ids use the **RIMS/Opta id space** as the canonical namespace
(World Rugby RIMS is Opta's rugby platform, so its numeric ids are Opta/Pulselive
ids). The old `rims:`/`espn:` source prefixes are gone.

- `teams` / `players` / `coaches`: keyed by their RIMS/Opta id (numeric for
  teams, numeric player ids for players and coaches). ESPN-sourced players are
  best-effort canonicalised onto their RIMS/Opta id via a shared display name.
- `venues`: keyed by the RIMS/Opta venue id (e.g. `"62"`) → `{name, city,
  country}`. ESPN venues have no Opta crosswalk, so they keep their ESPN id
  (e.g. `"98000"`).
- `leagues`: keyed by the RIMS competition name (e.g. `"Tour 2016"`) or, for
  ESPN-sourced matches, the ESPN league id (e.g. `"10659"`) → `{name,
  abbreviation}`. RIMS derives the key from the match's `competition`; ESPN
  from `header.league`.
- `coaches`: keyed by player id → display name. Populated from competitor
  roster entries flagged as coach / management in the source feed.

Only complete games are kept: both competitors present, non-empty rosters,
and both scores. Roster jerseys 1-15 are starters, 16-23 bench. Each
`games[]` entry now carries `venueId` and `leagueId`, and each
`competitors[]` entry carries `coachId`.
