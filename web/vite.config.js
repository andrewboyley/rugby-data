import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createReadStream, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "..");

// Vite dev and preview servers serve the app bundle, not the repo's data/.
// Serve the real files from the repo's data/ directory on /data/*.
function repoData() {
  const handleData = (req, res, next) => {
    const target = path.join(repoRoot, "data", req.url);
    const root = path.join(repoRoot, "data");
    if (existsSync(target) && path.resolve(target).startsWith(root)) {
      res.setHeader("Content-Type", "application/json");
      createReadStream(target).pipe(res);
    } else {
      next();
    }
  };
  return {
    name: "repo-data",
    configureServer(server) {
      server.middlewares.use("/data", handleData);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/data", handleData);
    },
  };
}

export default defineConfig({
  base: "./",
  build: { outDir: "../dist" },
  preview: { port: 8787, strictPort: true },
  plugins: [svelte(), repoData()],
});
