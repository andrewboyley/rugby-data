// Screen-size scalings for nodes and edges. Sizes are relative to the graph's
// maximum appearance count / edge weight so the whole view keeps its shape as
// the strongest node or edge grows.

const MIN_NODE_SIZE = 4;
const NODE_SIZE_SCALE = 3;

export function nodeSize(node, maxApp) {
	return MIN_NODE_SIZE + NODE_SIZE_SCALE * Math.sqrt((node.app || 0) / maxApp);
}

const MIN_EDGE_SIZE = 0.4;
const EDGE_SIZE_SCALE = 4.6;

export function edgeSize(weight, maxWeight) {
	return MIN_EDGE_SIZE + EDGE_SIZE_SCALE * Math.sqrt(weight / maxWeight);
}