import { TemporalAccumulator } from "./TemporalAccumulator";
import type { MatchTimeline } from "./MatchTimeline";
import { pairKey, pairNodes } from "./types";
import type { Delta, EdgeDelta, NodeId, PairKey } from "./types";

export type TemporalEdgeRecord = Readonly<{
  key: PairKey;
  source: NodeId;
  target: NodeId;
}>;

export type TemporalRenderState = Readonly<{
  nodeActive: Uint8Array;
  nodeCounts: Uint32Array;
  edgeActive: Uint8Array;
  edgeCounts: Uint32Array;
  edgeLatest: Float64Array;
  edgeWinRate: Float64Array;
  edgeWinRateKnown: Uint8Array;
}>;

export class TemporalIndexLookupError extends Error {
  readonly name = "TemporalIndexLookupError";

  constructor(readonly kind: "node" | "edge", readonly key: string) {
    super(`unknown ${kind} index: ${key}`);
  }
}

export class TemporalIndexDeltaError extends Error {
  readonly name = "TemporalIndexDeltaError";

  constructor(readonly edge: Pick<EdgeDelta, "source" | "target">) {
    super(`missing latest timestamp for edge ${edge.source},${edge.target}`);
  }
}

export class TemporalIndex {
  readonly nodeIds: readonly NodeId[];
  readonly edgeRecords: readonly TemporalEdgeRecord[];
  readonly nodeIndexById: ReadonlyMap<NodeId, number>;
  readonly edgeIndexByKey: ReadonlyMap<PairKey, number>;
  readonly allTimeNodeCounts: Uint32Array;
  readonly allTimeEdgeCounts: Uint32Array;
  readonly state: TemporalRenderState;

  private readonly accumulator: TemporalAccumulator;
  private activeNodes = 0;
  private activeEdges = 0;

  constructor(readonly timeline: MatchTimeline) {
    const topologyAccumulator = new TemporalAccumulator(timeline);
    topologyAccumulator.seek(timeline.dateMax ?? Number.NEGATIVE_INFINITY);
    const nodeIds = [...topologyAccumulator.playerCounts.keys()].sort();
    const edgeRecords = [...topologyAccumulator.pairCounts.keys()]
      .map((key) => {
        const [source, target] = pairNodes(key);
        return Object.freeze({ key: pairKey(source, target), source, target });
      })
      .sort((left, right) => left.key.localeCompare(right.key));
    const nodeIndexById = new Map<NodeId, number>();
    const edgeIndexByKey = new Map<PairKey, number>();

    nodeIds.forEach((nodeId, index) => nodeIndexById.set(nodeId, index));
    edgeRecords.forEach((edge, index) => edgeIndexByKey.set(edge.key, index));

    this.nodeIds = Object.freeze(nodeIds);
    this.edgeRecords = Object.freeze(edgeRecords);
    this.nodeIndexById = nodeIndexById;
    this.edgeIndexByKey = edgeIndexByKey;
    this.allTimeNodeCounts = Uint32Array.from(nodeIds, (nodeId) => topologyAccumulator.playerCounts.get(nodeId) ?? 0);
    this.allTimeEdgeCounts = Uint32Array.from(edgeRecords, (edge) => topologyAccumulator.pairCounts.get(edge.key) ?? 0);
    this.state = Object.freeze({
      nodeActive: new Uint8Array(nodeIds.length),
      nodeCounts: new Uint32Array(nodeIds.length),
      edgeActive: new Uint8Array(edgeRecords.length),
      edgeCounts: new Uint32Array(edgeRecords.length),
      edgeLatest: new Float64Array(edgeRecords.length),
      edgeWinRate: new Float64Array(edgeRecords.length),
      edgeWinRateKnown: new Uint8Array(edgeRecords.length),
    });
    this.accumulator = new TemporalAccumulator(timeline);
  }

  get currentTime(): number {
    return this.accumulator.currentTime;
  }

  get activeNodeCount(): number {
    return this.activeNodes;
  }

  get activeEdgeCount(): number {
    return this.activeEdges;
  }

  seek(targetTime: number): Delta {
    const delta = this.accumulator.seek(targetTime);
    this.applyDelta(delta);
    return delta;
  }

  nodeIndexOf(nodeId: NodeId): number {
    const index = this.nodeIndexById.get(nodeId);
    if (index === undefined) throw new TemporalIndexLookupError("node", nodeId);
    return index;
  }

  edgeIndexOf(source: NodeId, target: NodeId): number {
    return this.edgeIndexOfKey(pairKey(source, target));
  }

  edgeIndexOfKey(key: PairKey): number {
    const index = this.edgeIndexByKey.get(key);
    if (index === undefined) throw new TemporalIndexLookupError("edge", key);
    return index;
  }

  private applyDelta(delta: Delta): void {
    for (const nodeId of delta.addNodes) this.writeNodeCount(nodeId);
    for (const nodeId of delta.removeNodes) this.clearNode(nodeId);
    for (const [nodeId] of this.accumulator.playerCounts) this.writeNodeCount(nodeId);
    for (const edge of delta.addEdges) this.writeEdge(edge);
    for (const edge of delta.updateEdges) this.writeEdge(edge);
    for (const edge of delta.removeEdges) this.clearEdge(edge.source, edge.target);
  }

  private writeNodeCount(nodeId: NodeId): void {
    const count = this.accumulator.playerCounts.get(nodeId);
    if (count === undefined) throw new TemporalIndexLookupError("node", nodeId);
    const index = this.nodeIndexOf(nodeId);
    if (this.state.nodeActive[index] === 0) this.activeNodes += 1;
    this.state.nodeActive[index] = 1;
    this.state.nodeCounts[index] = count;
  }

  private clearNode(nodeId: NodeId): void {
    const index = this.nodeIndexOf(nodeId);
    if (this.state.nodeActive[index] === 1) this.activeNodes -= 1;
    this.state.nodeActive[index] = 0;
    this.state.nodeCounts[index] = 0;
  }

  private writeEdge(edge: EdgeDelta): void {
    if (edge.latest === undefined) throw new TemporalIndexDeltaError(edge);
    const index = this.edgeIndexOf(edge.source, edge.target);
    if (this.state.edgeActive[index] === 0) this.activeEdges += 1;
    this.state.edgeActive[index] = 1;
    this.state.edgeCounts[index] = edge.count;
    this.state.edgeLatest[index] = edge.latest;
    this.state.edgeWinRateKnown[index] = edge.winRate == null ? 0 : 1;
    this.state.edgeWinRate[index] = edge.winRate ?? 0;
  }

  private clearEdge(source: NodeId, target: NodeId): void {
    const index = this.edgeIndexOf(source, target);
    if (this.state.edgeActive[index] === 1) this.activeEdges -= 1;
    this.state.edgeActive[index] = 0;
    this.state.edgeCounts[index] = 0;
    this.state.edgeLatest[index] = 0;
    this.state.edgeWinRate[index] = 0;
    this.state.edgeWinRateKnown[index] = 0;
  }
}
