import Graph from "graphology";
import { circular } from "graphology-layout";

export interface GraphSpec {
  nodeCount: number;
  clusterCount: number;
  degreeRatio: number;
  seed: number;
}

export interface GraphGenResult {
  graph: Graph;
  estimatedEdges: number;
  maxEdgesExceeded: boolean;
}

const MAX_EDGES = 15000;

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
  while (est > MAX_EDGES && nodeCount > 10) {
    nodeCount = Math.max(10, nodeCount - 10);
    est = estimateEdges({ nodeCount, clusterCount, degreeRatio, seed });
  }
  return { nodeCount, clusterCount, degreeRatio, seed };
}

export function generateGraph(spec: GraphSpec): GraphGenResult {
  const clamped = clampNodeCount(spec);
  const { nodeCount, clusterCount, degreeRatio, seed } = clamped;
  const rand = mulberry32(seed);

  const graph = new Graph({ multi: false });
  const clusterSize = Math.max(1, Math.floor(nodeCount / clusterCount));
  const clusters: number[][] = [];

  for (let c = 0; c < clusterCount; c++) {
    const start = c * clusterSize;
    const end = Math.min(start + clusterSize, nodeCount);
    clusters.push(Array.from({ length: end - start }, (_, i) => start + i));
  }

  for (let i = 0; i < nodeCount; i++) {
    graph.addNode(i, {
      x: (rand() - 0.5) * 200,
      y: (rand() - 0.5) * 200,
      size: 1 + rand() * 3,
      color: `hsl(${(i / nodeCount) * 360}, 70%, 50%)`,
    });
  }

  const targetEdges = Math.round((nodeCount * nodeCount * degreeRatio) / 2);
  let edgesAdded = 0;

  for (const cluster of clusters) {
    for (let i = 0; i < cluster.length; i++) {
      for (let j = i + 1; j < cluster.length; j++) {
        if (edgesAdded >= targetEdges) break;
        if (rand() < degreeRatio * 2) {
          graph.addEdge(cluster[i], cluster[j]);
          edgesAdded++;
        }
      }
    }
  }

  for (let i = 0; i < nodeCount; i++) {
    for (let j = i + 1; j < nodeCount; j++) {
      if (edgesAdded >= targetEdges) break;
      if (graph.hasEdge(i, j)) continue;
      if (rand() < degreeRatio * 0.1) {
        graph.addEdge(i, j);
        edgesAdded++;
      }
    }
  }

  circular.assign(graph, { scale: 100 });
  return {
    graph,
    estimatedEdges: estimateEdges(clamped),
    maxEdgesExceeded: clamped.nodeCount !== spec.nodeCount,
  };
}

export { estimateEdges, clampNodeCount, MAX_EDGES };