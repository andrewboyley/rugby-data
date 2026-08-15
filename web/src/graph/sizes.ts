// Screen-size scalings for nodes and edges.

const MIN_NODE_SIZE = 4;
const NODE_SIZE_SCALE = 3;

export function nodeSize(node: { app: number }, maxApp: number): number {
  return MIN_NODE_SIZE + NODE_SIZE_SCALE * Math.sqrt((node.app || 0) / maxApp);
}

const MIN_EDGE_SIZE = 0.4;
const EDGE_SIZE_SCALE = 4.6;

export function edgeSize(weight: number, maxWeight: number): number {
  return MIN_EDGE_SIZE + EDGE_SIZE_SCALE * Math.sqrt(weight / maxWeight);
}
