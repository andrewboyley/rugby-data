import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "..");

// Vite dev and preview servers serve the app bundle, not the repo's data/.
// Serve the real files from the repo's data/ directory on /data/*.
// JSON payloads (12 MB graph.json) are pre-compressed once per file version and
// served brotli/gzip so the browser does not download raw megabytes.
const encCache = new Map();
async function readCached(target) {
  const stat = statSync(target);
  const key = `${target}:${stat.size}:${stat.mtimeMs}`;
  let entry = encCache.get(key);
  if (!entry) {
    const raw = await readFile(target);
    entry = {
      raw,
      br: brotliCompressSync(raw, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 },
      }),
      gzip: gzipSync(raw),
    };
    if (encCache.size > 32) encCache.clear();
    encCache.set(key, entry);
  }
  return entry;
}

function repoData() {
  const handleData = (req, res, next) => {
    const target = path.join(repoRoot, "data", req.url);
    const root = path.join(repoRoot, "data");
    const safe =
      existsSync(target) &&
      statSync(target).isFile() &&
      path.resolve(target).startsWith(root);
    if (!safe) {
      next();
      return;
    }
    const ext = path.extname(target).toLowerCase();
    if (ext === ".json") {
      res.setHeader("Content-Type", "application/json");
    } else {
      res.setHeader("Content-Type", "application/octet-stream");
    }
    const accept = req.headers["accept-encoding"] || "";
    readCached(target)
      .then((entry) => {
        let body, encoding;
        if (/\bbr\b/.test(accept)) {
          body = entry.br;
          encoding = "br";
        } else if (/\bgzip\b/.test(accept)) {
          body = entry.gzip;
          encoding = "gzip";
        } else {
          body = entry.raw;
        }
        if (encoding) {
          res.setHeader("Content-Encoding", encoding);
          res.setHeader("Vary", "Accept-Encoding");
        }
        res.setHeader("Content-Length", body.length);
        res.end(body);
      })
      .catch(() => next());
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
