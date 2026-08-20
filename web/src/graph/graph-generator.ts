import Graph from "graphology";
import { CLUSTER_COLORS, mixHexColors } from "./colors";

export interface GraphSpec {
  nodeCount: number;
  clusterCount: number;
  degreeRatio: number;
  edgeWeight: number;
  seed: number;
  onlyWithinCluster?: boolean;
}

export interface GraphGenResult {
  graph: Graph;
  estimatedEdges: number;
  maxEdgesExceeded: boolean;
}

const MAX_EDGES = 15000;
const NODE_SIZE_PER_DEGREE = 0.5;
const MIN_NODE_SIZE = 2;
const MAX_NODE_SIZE = 5;

export const UNIT_CIRCLE_OPTIONS = { scale: 100, center: 0 } as const;

export function assignUnitCircle(graph: Graph): void {
  const groups = new Map<string, string[]>();
  graph.forEachNode((node, attrs) => {
    const group = groups.get(String(attrs.color)) ?? [];
    group.push(node);
    groups.set(String(attrs.color), group);
  });
  const ordered: string[] = [];
  const groupList = [...groups.values()];
  const maxGroupSize = Math.max(...groupList.map((group) => group.length), 0);
  for (let index = 0; index < maxGroupSize; index++) {
    for (const group of groupList) {
      if (group[index]) ordered.push(group[index]);
    }
  }
  ordered.forEach((node, index) => {
    const angle = (index / ordered.length) * Math.PI * 2;
    graph.setNodeAttribute(node, "x", UNIT_CIRCLE_OPTIONS.center + UNIT_CIRCLE_OPTIONS.scale * Math.cos(angle));
    graph.setNodeAttribute(node, "y", UNIT_CIRCLE_OPTIONS.center + UNIT_CIRCLE_OPTIONS.scale * Math.sin(angle));
  });
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
  let { nodeCount, clusterCount, degreeRatio, edgeWeight, seed } = spec;
  let est = estimateEdges({ nodeCount, clusterCount, degreeRatio, edgeWeight, seed });
  while (est > MAX_EDGES && nodeCount > 1) {
    nodeCount = Math.max(1, nodeCount - 10);
    est = estimateEdges({ nodeCount, clusterCount, degreeRatio, edgeWeight, seed });
  }
  return { nodeCount, clusterCount, degreeRatio, edgeWeight, seed };
}

export function generateGraph(spec: GraphSpec): GraphGenResult {
  const clamped = clampNodeCount(spec);
  const { nodeCount, clusterCount, degreeRatio, seed, edgeWeight } = clamped;
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

  function edgeWeightValue(): number {
    // Seeded variation keeps edge thickness deterministic for the same graph settings.
    return edgeWeight * (0.5 + rand());
  }

  for (let i = 0; i < nodeCount; i++) {
    graph.addNode(i, {
      x: rand(),
      y: rand(),
      size: 0.02,
      color: clusterColor(i),
    });
  }

  const targetEdges = Math.max(nodeCount - clusterCount, Math.round((nodeCount * nodeCount * degreeRatio) / 2));
  let edgesAdded = 0;

  for (let c = 0; c < clusterCount; c++) {
    const start = c * clusterSize;
    const end = Math.min(start + clusterSize, nodeCount);
    for (let node = start + 1; node < end; node++) {
      graph.addEdge(node - 1, node, { color: clusterColor(node - 1), weight: edgeWeightValue() });
      edgesAdded++;
    }
    for (let i = start; i < end; i++) {
      for (let j = i + 1; j < end; j++) {
        if (edgesAdded >= targetEdges) break;
        if (graph.hasEdge(i, j)) continue;
        if (rand() < degreeRatio * 2) {
          graph.addEdge(i, j, { color: clusterColor(i), weight: edgeWeightValue() });
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
           graph.addEdge(i, j, { color: edgeColor(i, j), weight: edgeWeightValue() });
          edgesAdded++;
        }
      }
    }
  }

  // Guarantee that sparse generation never leaves a node isolated.
  for (let i = 0; i < nodeCount; i++) {
    if (graph.degree(i) > 0 || nodeCount < 2) continue;
    let target = i === nodeCount - 1 ? 0 : i + 1;
    if (onlyWithinCluster) {
      const clusterStart = clusterOf(i) * clusterSize;
      target = clusterStart === i ? clusterStart + 1 : clusterStart;
      if (target >= nodeCount || clusterOf(target) !== clusterOf(i)) continue;
    }
    if (graph.hasEdge(i, target)) continue;
    graph.addEdge(i, target, { color: edgeColor(i, target), weight: edgeWeightValue() });
  }

  graph.forEachNode((id) => {
    graph.setNodeAttribute(id, "size", Math.min(MAX_NODE_SIZE, Math.max(MIN_NODE_SIZE, graph.degree(id) * NODE_SIZE_PER_DEGREE)));
  });

  assignUnitCircle(graph);

  return {
    graph,
    estimatedEdges: estimateEdges(clamped),
    maxEdgesExceeded: clamped.nodeCount !== spec.nodeCount,
  };
}

export { estimateEdges, clampNodeCount, MAX_EDGES };
