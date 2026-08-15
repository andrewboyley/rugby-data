import type { Sigma } from "sigma";

// Deduplicate sigma hit-testing (gl.readPixels) to at most one lookup
// per animation frame, avoiding main-thread stalls on mousemove.

const FRAME_BUCKET_MS = 17;

export function dedupeNodeHitTest(sigma: Sigma): void {
  const rawGetNodeAtPosition = (sigma as any).getNodeAtPosition.bind(sigma);
  let pixelReadBucket = -1;
  const cache = new Map<string, string | null>();
  (sigma as any).getNodeAtPosition = (position: { x: number; y: number }): string | null => {
    const bucket = (performance.now() / FRAME_BUCKET_MS) | 0;
    if (bucket !== pixelReadBucket) {
      pixelReadBucket = bucket;
      cache.clear();
    }
    const key = `${position.x},${position.y}`;
    if (cache.has(key)) return cache.get(key)!;
    const result = rawGetNodeAtPosition(position);
    cache.set(key, result);
    return result;
  };
}
