# Rugby composition viewer

Svelte 5 + Vite single-page app for the player co-occurrence graph. The main
page currently starts with an empty dataset so the base graph interactions can
be developed and tested without loading `data/dataset.json`.

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

The dev and preview servers still proxy `/data/dataset.json` to the repo's
`data/` directory via a small Vite plugin (`vite.config.js`) for future dataset
loading work.
