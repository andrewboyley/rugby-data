// Screen-size scalings for nodes and edges.

const MIN_NODE_SIZE = 4;
const NODE_SIZE_SCALE = 3;
const COACH_SIZE_MULTIPLIER = 1.4;

export function nodeSize(node: { app: number; isCoach?: boolean }, maxApp: number): number {
  const base = MIN_NODE_SIZE + NODE_SIZE_SCALE * Math.sqrt((node.app || 0) / maxApp);
  return node.isCoach ? base * COACH_SIZE_MULTIPLIER : base;
}

const MIN_EDGE_SIZE = 0.4;
const EDGE_SIZE_SCALE = 4.6;

export function edgeSize(weight: number, maxWeight: number): number {
  return MIN_EDGE_SIZE + EDGE_SIZE_SCALE * Math.sqrt(weight / maxWeight);
}
