# Rugby composition viewer

Svelte 5 + Vite single-page app that renders the player co-occurrence graph
from `data/dataset.json`. Nodes are players (size = appearances, colour =
degree), edges connect players who shared a match (width = co-occurrences).
Filters by minimum shared matches, maximum degree and team; click a node to
focus its teammates.

## Develop

```sh
npm install
npm run dev      # dev server on :5173 (serves /data/* from the repo)
```

## Build

```sh
npm run build    # emits repo-root dist/ with relative asset paths
```

Serve the built app with Vite (also serves `/data/*` from the repo):

```sh
npm run preview  # http://localhost:8787/
```

The dev server proxies `/data/dataset.json` to the repo's `data/` directory via
a small Vite plugin (`vite.config.js`); the preview server does the same, so
the production build fetches `/data/dataset.json` from the static server.
