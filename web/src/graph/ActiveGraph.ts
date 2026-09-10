import { UndirectedGraph } from "graphology";
import type { Delta, EdgeDelta, NodeId } from "../temporal/types";

export class ActiveGraph {
  readonly graph = new UndirectedGraph();
  readonly positions = new Map<NodeId, { x: number; y: number }>();

  applyDelta(delta: Delta): void {
    for (const node of delta.addNodes) if (!this.graph.hasNode(node)) this.graph.addNode(node, this.nodeAttributes(node, delta.addEdges));
    for (const edge of delta.addEdges) this.setEdge(edge);
    for (const edge of delta.updateEdges) this.setEdge(edge);
    // A backward batch can decrement an edge and then remove it; removals win.
    for (const edge of delta.removeEdges) if (this.graph.hasEdge(edge.source, edge.target)) this.graph.dropEdge(edge.source, edge.target);
    for (const node of delta.removeNodes) {
      if (!this.graph.hasNode(node)) continue;
      const { x, y } = this.graph.getNodeAttributes(node);
      this.positions.set(node, { x: Number(x), y: Number(y) });
      this.graph.dropNode(node);
    }
  }

  assertMatches(pairCounts: ReadonlyMap<string, number>, playerCounts?: ReadonlyMap<NodeId, number>): void {
    if (playerCounts) {
      if (this.graph.order !== playerCounts.size) throw new Error("active graph node set differs from accumulator");
      for (const node of this.graph.nodes()) if (!playerCounts.has(node) || playerCounts.get(node)! <= 0) throw new Error(`active graph node set differs from accumulator: ${node}`);
    }
    if (this.graph.size !== pairCounts.size) throw new Error("active graph edge count differs from accumulator");
    this.graph.forEachEdge((edge, attrs, source, target) => {
      const expected = pairCounts.get(source < target ? `${source},${target}` : `${target},${source}`);
      if (expected !== Number(attrs.matchCount)) throw new Error(`edge ${edge} differs from accumulator`);
    });
  }

  private nodeAttributes(node: NodeId, edges: EdgeDelta[]): { x: number; y: number; label: string; size: number; team: number | null } {
    const cached = this.positions.get(node);
    if (cached) return { ...cached, label: node, size: 1, team: null };
    const neighbors = edges.flatMap((edge) => edge.source === node ? [edge.target] : edge.target === node ? [edge.source] : []).filter((id) => this.graph.hasNode(id));
    const centroid = neighbors.length ? neighbors.reduce((sum, id) => ({ x: sum.x + Number(this.graph.getNodeAttribute(id, "x")), y: sum.y + Number(this.graph.getNodeAttribute(id, "y")) }), { x: 0, y: 0 }) : null;
    const jitter = () => (Math.random() - 0.5) * 0.02;
    return centroid ? { x: centroid.x / neighbors.length + jitter(), y: centroid.y / neighbors.length + jitter(), label: node, size: 1, team: null } : { x: jitter(), y: jitter(), label: node, size: 1, team: null };
  }

  private setEdge({ source, target, count, latest = Number.NEGATIVE_INFINITY, winRate = null }: EdgeDelta): void {
    const attributes = { matchCount: count, weight: Math.sqrt(count), size: 0.5 + Math.log2(count + 1), latest, winRate };
    if (this.graph.hasEdge(source, target)) this.graph.mergeEdgeAttributes(source, target, attributes);
    else this.graph.addEdge(source, target, attributes);
  }
}
