# Rugby composition viewer

Svelte 5 + Vite single-page app for the player co-occurrence graph. The main
page loads the included single-player synthetic fixture by default. Supply
another synthetic dataset with `/#dataset=/data/example.json`. Loading and
failure states appear as toasts. Browser tests route `/data/dataset.json` to
fixture data.

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

The dev and preview servers serve `/data/dataset.json` from the repository
`data/` directory via the `repo-data` Vite plugin (`vite.config.ts`).
