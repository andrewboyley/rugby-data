import Graph from "graphology";
import { circular } from "graphology-layout";
import { CLUSTER_COLORS, mixHexColors } from "./colors";

export interface GraphSpec {
  nodeCount: number;
  clusterCount: number;
  degreeRatio: number;
  seed: number;
  onlyWithinCluster?: boolean;
}

export interface GraphGenResult {
  graph: Graph;
  estimatedEdges: number;
  maxEdgesExceeded: boolean;
}

const MAX_EDGES = 15000;

// Graphology circular layout options producing a unit circle inscribed in the
// normalized [0, 1] square (sigma v4 "framedGraph" space): scale 0.5 gives a
// radius of 0.5 and center 1.5 shifts the offset so positions land in [0, 1].
export const UNIT_CIRCLE_OPTIONS = { scale: 0.5, center: 1.5 } as const;

export function assignUnitCircle(graph: Graph): void {
  circular.assign(graph, UNIT_CIRCLE_OPTIONS);
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function estimateEdges(spec: GraphSpec): number {
  const { nodeCount, degreeRatio } = spec;
  return Math.round((nodeCount * nodeCount * degreeRatio) / 2);
}

function clampNodeCount(spec: GraphSpec): GraphSpec {
  let { nodeCount, clusterCount, degreeRatio, seed } = spec;
  let est = estimateEdges({ nodeCount, clusterCount, degreeRatio, seed });
  while (est > MAX_EDGES && nodeCount > 1) {
    nodeCount = Math.max(1, nodeCount - 10);
    est = estimateEdges({ nodeCount, clusterCount, degreeRatio, seed });
  }
  return { nodeCount, clusterCount, degreeRatio, seed };
}

export function generateGraph(spec: GraphSpec): GraphGenResult {
  const clamped = clampNodeCount(spec);
  const { nodeCount, clusterCount, degreeRatio, seed } = clamped;
  const onlyWithinCluster = spec.onlyWithinCluster ?? false;
  const rand = mulberry32(seed);

  const graph = new Graph({ multi: false });
  const clusterSize = Math.max(1, Math.floor(nodeCount / clusterCount));

  function clusterOf(nodeId: number): number {
    return Math.min(Math.floor(nodeId / clusterSize), clusterCount - 1);
  }

  function clusterColor(nodeId: number): string {
    const c = clusterOf(nodeId);
    if (c < CLUSTER_COLORS.length) return CLUSTER_COLORS[c];
    return `hsl(${(c / clusterCount) * 360}, 65%, 50%)`;
  }

  function edgeColor(src: number, tgt: number): string {
    const cs = clusterOf(src);
    const ct = clusterOf(tgt);
    if (cs === ct) return clusterColor(src);
    return mixHexColors(CLUSTER_COLORS[cs % CLUSTER_COLORS.length], CLUSTER_COLORS[ct % CLUSTER_COLORS.length]);
  }

  for (let i = 0; i < nodeCount; i++) {
    graph.addNode(i, {
      x: rand(),
      y: rand(),
      size: 12 + rand() * 8,
      color: clusterColor(i),
    });
  }

  const targetEdges = Math.round((nodeCount * nodeCount * degreeRatio) / 2);
  let edgesAdded = 0;

  for (let c = 0; c < clusterCount; c++) {
    const start = c * clusterSize;
    const end = Math.min(start + clusterSize, nodeCount);
    for (let i = start; i < end; i++) {
      for (let j = i + 1; j < end; j++) {
        if (edgesAdded >= targetEdges) break;
        if (rand() < degreeRatio * 2) {
          graph.addEdge(i, j, { color: clusterColor(i) });
          edgesAdded++;
        }
      }
    }
  }

  if (!onlyWithinCluster) {
    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        if (edgesAdded >= targetEdges) break;
        if (graph.hasEdge(i, j)) continue;
        if (rand() < degreeRatio * 0.1) {
          graph.addEdge(i, j, { color: edgeColor(i, j) });
          edgesAdded++;
        }
      }
    }
  }

  assignUnitCircle(graph);
  return {
    graph,
    estimatedEdges: estimateEdges(clamped),
    maxEdgesExceeded: clamped.nodeCount !== spec.nodeCount,
  };
}

export { estimateEdges, clampNodeCount, MAX_EDGES };