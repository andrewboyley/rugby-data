import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "..");

const encCache = new Map<string, {
  raw: Buffer;
  br: Buffer;
  gzip: Buffer;
}>();
async function readCached(target: string) {
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
  const handleData = (req: any, res: any, next: () => void) => {
    const root = path.join(repoRoot, "data");
    const pathname = new URL(req.url, "http://localhost").pathname;
    const target = path.resolve(root, `.${pathname}`);
    let safe = false;
    try {
      safe =
        existsSync(target) &&
        statSync(target).isFile() &&
        target.startsWith(`${root}${path.sep}`);
    } catch (e) {
      // If any synchronous check fails, treat as unsafe to prevent 500 errors
      safe = false;
    }
    if (!safe) {
      next();
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.setHeader("Content-Type", ext === ".json" ? "application/json" : "application/octet-stream");
    const accept = req.headers["accept-encoding"] || "";
    readCached(target)
      .then((entry) => {
        let body: Buffer;
        let encoding: string | undefined;
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
    configureServer(server: any) {
      server.middlewares.use("/data", handleData);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use("/data", handleData);
    },
  };
}

export default defineConfig({
  base: "/",
  build: { outDir: "../dist" },
  preview: { port: 8787, strictPort: true },
  plugins: [svelte(), repoData()],
});
