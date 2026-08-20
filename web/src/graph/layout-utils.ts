import Graph from "graphology";
import type { LayoutTickStats } from "./layout";

function defaultAesthetics(): AestheticMetrics {
  return {
    edgeCrossings: 0,
    minCrossingAngle: null,
    meanCrossingAngle: null,
    angularResolution: null,
    edgeLengthCV: 0,
    nodeSpread: 0,
    aspectRatio: 1,
    totalEdgeLength: 0,
  };
}

interface AestheticMetrics {
  edgeCrossings: number;
  minCrossingAngle: number | null;
  meanCrossingAngle: number | null;
  angularResolution: number | null;
  edgeLengthCV: number;
  nodeSpread: number;
  aspectRatio: number;
  totalEdgeLength: number;
}

function computeAesthetics(g: Graph | null): AestheticMetrics {
  const def = defaultAesthetics();
  if (!g || g.order === 0) return def;
  const n = g.order;
  const m = g.size;
  if (m === 0) return def;

  const ids: string[] = new Array(n);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let k = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  g.forEachNode((id: string, attrs: Record<string, unknown>) => {
    const a = attrs as { x: number; y: number };
    ids[k] = id; xs[k] = a.x; ys[k] = a.y;
    if (a.x < minX) minX = a.x; if (a.x > maxX) maxX = a.x;
    if (a.y < minY) minY = a.y; if (a.y > maxY) maxY = a.y;
    k++;
  });
  const index = new Map<string, number>();
  for (let i = 0; i < n; i++) index.set(ids[i], i);

  const lengths = new Float64Array(m);
  const su = new Int32Array(m);
  const sv = new Int32Array(m);
  let totalEdgeLength = 0;
  let ei = 0;
  g.forEachEdge((_e: unknown, _a: unknown, source: string, target: string) => {
    const si = index.get(source)!;
    const ti = index.get(target)!;
    const dx = xs[ti] - xs[si], dy = ys[ti] - ys[si];
    const len = Math.hypot(dx, dy);
    lengths[ei] = len;
    su[ei] = si; sv[ei] = ti;
    totalEdgeLength += len;
    ei++;
  });

  const meanLen = totalEdgeLength / m;
  let varSum = 0;
  for (let i = 0; i < m; i++) { const d = lengths[i] - meanLen; varSum += d * d; }
  const stdLen = Math.sqrt(varSum / m);
  const edgeLengthCV = meanLen > 1e-9 ? stdLen / meanLen : 0;

  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { vx += (xs[i] - mx) ** 2; vy += (ys[i] - my) ** 2; }
  const nodeSpread = Math.sqrt(vx / n + vy / n);

  const w = maxX - minX, h = maxY - minY;
  const aspectRatio = h > 1e-9 ? w / h : (w > 1e-9 ? Infinity : 1);

  const adj = new Map<number, Array<[number, number]>>();
  for (let e = 0; e < m; e++) {
    const a = su[e], b = sv[e];
    const ax = xs[a], ay = ys[a], bx = xs[b], by = ys[b];
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push([bx - ax, by - ay]);
    adj.get(b)!.push([ax - bx, ay - by]);
  }
  let arSum = 0, arCount = 0;
  for (const [, vecs] of adj) {
    if (vecs.length < 2) continue;
    const angs = vecs.map(([dx, dy]) => Math.atan2(dy, dx)).sort((p, q) => p - q);
    let localMin = Infinity;
    for (let j = 0; j < angs.length; j++) {
      const a1 = angs[j];
      const a2 = angs[(j + 1) % angs.length];
      let diff = Math.abs(a2 - a1);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff < localMin) localMin = diff;
    }
    arSum += (localMin * 180) / Math.PI;
    arCount++;
  }
  const angularResolution = arCount > 0 ? arSum / arCount : null;

  let edgeCrossings = 0;
  let sumCrossAngle = 0, crossCount = 0;
  let minCrossingAngle = Infinity;
  if (m > 1) {
    const span = Math.max(w, h);
    const cells = Math.max(1, Math.floor(Math.sqrt(m)));
    const cellSize = Math.max(span / cells, 1e-9);
    const buckets = new Map<string, number[]>();
    for (let e = 0; e < m; e++) {
      const ax = xs[su[e]], ay = ys[su[e]], bx = xs[sv[e]], by = ys[sv[e]];
      const c0x = Math.floor((Math.min(ax, bx) - minX) / cellSize);
      const c1x = Math.floor((Math.max(ax, bx) - minX) / cellSize);
      const c0y = Math.floor((Math.min(ay, by) - minY) / cellSize);
      const c1y = Math.floor((Math.max(ay, by) - minY) / cellSize);
      for (let cx = c0x; cx <= c1x; cx++) {
        for (let cy = c0y; cy <= c1y; cy++) {
          const key = cx + "," + cy;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key)!.push(e);
        }
      }
    }
    const tested = new Set<number>();
    const segInt = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) => {
      const r1 = (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);
      const r2 = (dx - ax) * (by - ay) - (dy - ay) * (bx - ax);
      const r3 = (ax - cx) * (dy - cy) - (ay - cy) * (dx - cx);
      const r4 = (bx - cx) * (dy - cy) - (by - cy) * (dx - cx);
      return (r1 * r2 < 0) && (r3 * r4 < 0);
    };
    for (const [, list] of buckets) {
      for (let p = 0; p < list.length; p++) {
        for (let q = p + 1; q < list.length; q++) {
          const e = list[p], f = list[q];
          if (e === f) continue;
          const key = e < f ? e * m + f : f * m + e;
          if (tested.has(key)) continue;
          tested.add(key);
          if (su[e] === su[f] || su[e] === sv[f] || sv[e] === su[f] || sv[e] === sv[f]) continue;
          const ax = xs[su[e]], ay = ys[su[e]], bx = xs[sv[e]], by = ys[sv[e]];
          const cx = xs[su[f]], cy = ys[su[f]], dx = xs[sv[f]], dy = ys[sv[f]];
          if (segInt(ax, ay, bx, by, cx, cy, dx, dy)) {
            edgeCrossings++;
            const d1x = bx - ax, d1y = by - ay, d2x = dx - cx, d2y = dy - cy;
            const dot = d1x * d2x + d1y * d2y;
            const m1 = Math.hypot(d1x, d1y), m2 = Math.hypot(d2x, d2y);
            let ang = Infinity;
            if (m1 > 1e-9 && m2 > 1e-9) ang = Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2)))) * 180 / Math.PI;
            if (ang < minCrossingAngle) minCrossingAngle = ang;
            sumCrossAngle += ang; crossCount++;
          }
        }
      }
    }
  }
  return {
    edgeCrossings,
    minCrossingAngle: edgeCrossings > 0 ? minCrossingAngle : null,
    meanCrossingAngle: crossCount > 0 ? sumCrossAngle / crossCount : null,
    angularResolution,
    edgeLengthCV,
    nodeSpread,
    aspectRatio: isFinite(aspectRatio) ? aspectRatio : 1,
    totalEdgeLength,
  };
}

export function computeTickStats(
  graph: Graph,
  prev: Map<string, { x: number; y: number }>
): LayoutTickStats | null {
  if (!graph || graph.order === 0 || prev.size === 0) return null;
  let totalDisp = 0, maxDisp = 0, sumSqDisp = 0, count = 0;
  graph.forEachNode((id: string, attrs: Record<string, unknown>) => {
    const a = attrs as { x: number; y: number };
    const p = prev.get(id);
    if (p) {
      const dx = a.x - p.x, dy = a.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      totalDisp += d; sumSqDisp += d * d;
      if (d > maxDisp) maxDisp = d;
      count++;
    }
  });
  if (count === 0) return null;
  const mean = totalDisp / count;
  const variance = count > 1 ? sumSqDisp / count - mean * mean : 0;
  const am = computeAesthetics(graph);
  let sumDist = 0;
  graph.forEachNode((_id: string, b: Record<string, unknown>) => {
    const nb = b as { x: number; y: number };
    sumDist += Math.hypot(nb.x, nb.y);
  });
  return {
    timestamp: performance.now(),
    meanDisplacement: mean,
    maxDisplacement: maxDisp,
    stdDisplacement: Math.sqrt(Math.max(0, variance)),
    kineticEnergy: totalDisp,
		nodeCount: graph.order,
		edgeCrossings: am.edgeCrossings,
    minCrossingAngle: am.minCrossingAngle ?? 0,
    meanCrossingAngle: am.meanCrossingAngle ?? 0,
    angularResolution: am.angularResolution ?? 0,
    edgeLengthCV: am.edgeLengthCV,
    nodeSpread: am.nodeSpread,
    aspectRatio: am.aspectRatio,
    totalEdgeLength: am.totalEdgeLength,
    centerDistRatio: am.totalEdgeLength > 1e-9 ? sumDist / am.totalEdgeLength : 0,
  };
}

export function sanitizePositions(graph: Graph, previousPositions: Map<string, { x: number; y: number }>): number {
  if (!graph) return 0;
  let bad = 0;
  graph.forEachNode((id: string, attrs: Record<string, unknown>) => {
    const a = attrs as { x: number; y: number };
    if (Number.isFinite(a.x) && Number.isFinite(a.y)) return;
    const p = previousPositions.get(id);
    graph.setNodeAttribute(id, "x", p && Number.isFinite(p.x) ? p.x : 0);
    graph.setNodeAttribute(id, "y", p && Number.isFinite(p.y) ? p.y : 0);
    bad++;
  });
  return bad;
}

export function savePositions(graph: Graph | null): Map<string, { x: number; y: number }> {
  const map = new Map<string, { x: number; y: number }>();
  if (!graph) return map;
  graph.forEachNode((id: string, attrs: Record<string, unknown>) => {
    const a = attrs as { x: number; y: number };
    map.set(id, { x: a.x, y: a.y });
  });
  return map;
}
