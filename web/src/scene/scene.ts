import type { NodeId, PairKey } from "../temporal/types";

export type SceneNodeKind = "player" | "coach";

export type SceneNodeRecord = Readonly<{
  id: NodeId;
  label: string;
  kind: SceneNodeKind;
  teams: readonly number[];
}>;

export type SceneEdgeRecord = Readonly<{
  key: PairKey;
  source: NodeId;
  target: NodeId;
}>;

export type DirtyRange = Readonly<{
  start: number;
  endExclusive: number;
}>;

export type SceneDirtyRanges = Readonly<{
  nodes: readonly DirtyRange[];
  edges: readonly DirtyRange[];
}>;

export type NodeSlotStorage = Readonly<{
  records: readonly SceneNodeRecord[];
  slotById: ReadonlyMap<NodeId, number>;
  alpha: Float32Array;
  targetAlpha: Float32Array;
  scale: Float32Array;
  targetScale: Float32Array;
  previousX: Float32Array;
  previousY: Float32Array;
  currentX: Float32Array;
  currentY: Float32Array;
  x: Float32Array;
  y: Float32Array;
  interactive: Uint8Array;
  transitioning: Uint8Array;
}>;

export type EdgeSlotStorage = Readonly<{
  capacity: number;
  sourceSlots: Int32Array;
  targetSlots: Int32Array;
  alpha: Float32Array;
  targetAlpha: Float32Array;
  scale: Float32Array;
  targetScale: Float32Array;
  interactive: Uint8Array;
  transitioning: Uint8Array;
}>;

export type SceneSlotStorage = Readonly<{
  nodes: NodeSlotStorage;
  edges: EdgeSlotStorage;
}>;

export type ScenePatch = Readonly<{
  dirty: SceneDirtyRanges;
  nodeSlots?: readonly number[];
  edgeSlots?: readonly number[];
}>;

export type PositionSnapshot = Readonly<{
  sequence: number;
  positions: Float32Array;
}>;

export type SceneRendererPort = Readonly<{
  applyPatch(patch: ScenePatch, slots: SceneSlotStorage): void;
  render(): void;
  dispose(): void;
}>;

export type SceneLayoutPort = Readonly<{
  subscribe(listener: (snapshot: PositionSnapshot) => void): () => void;
  dispose(): void;
}>;

export function createSceneSlotStorage(
  records: readonly SceneNodeRecord[],
  edgeCapacity: number,
): SceneSlotStorage {
  if (!Number.isSafeInteger(edgeCapacity) || edgeCapacity < 0) {
    throw new RangeError("edgeCapacity must be a non-negative safe integer");
  }

  const slotById = new Map<NodeId, number>();
  records.forEach((record, slot) => {
    if (slotById.has(record.id)) throw new Error(`duplicate scene node id: ${record.id}`);
    slotById.set(record.id, slot);
  });

  const nodeCount = records.length;
  const sourceSlots = new Int32Array(edgeCapacity);
  const targetSlots = new Int32Array(edgeCapacity);
  sourceSlots.fill(-1);
  targetSlots.fill(-1);

  return Object.freeze({
    nodes: Object.freeze({
      records: Object.freeze([...records]),
      slotById,
      alpha: new Float32Array(nodeCount),
      targetAlpha: new Float32Array(nodeCount),
      scale: new Float32Array(nodeCount),
      targetScale: new Float32Array(nodeCount),
      previousX: new Float32Array(nodeCount),
      previousY: new Float32Array(nodeCount),
      currentX: new Float32Array(nodeCount),
      currentY: new Float32Array(nodeCount),
      x: new Float32Array(nodeCount),
      y: new Float32Array(nodeCount),
      interactive: new Uint8Array(nodeCount),
      transitioning: new Uint8Array(nodeCount),
    }),
    edges: Object.freeze({
      capacity: edgeCapacity,
      sourceSlots,
      targetSlots,
      alpha: new Float32Array(edgeCapacity),
      targetAlpha: new Float32Array(edgeCapacity),
      scale: new Float32Array(edgeCapacity),
      targetScale: new Float32Array(edgeCapacity),
      interactive: new Uint8Array(edgeCapacity),
      transitioning: new Uint8Array(edgeCapacity),
    }),
  });
}

export function dirtyRanges(slots: Iterable<number>): readonly DirtyRange[] {
  const sortedSlots = [...new Set(slots)].sort((left, right) => left - right);
  if (sortedSlots.length === 0) return Object.freeze([]);

  const ranges: DirtyRange[] = [];
  let start = sortedSlots[0]!;
  let endExclusive = start + 1;
  for (const slot of sortedSlots.slice(1)) {
    if (slot === endExclusive) {
      endExclusive += 1;
      continue;
    }
    ranges.push(Object.freeze({ start, endExclusive }));
    start = slot;
    endExclusive = slot + 1;
  }
  ranges.push(Object.freeze({ start, endExclusive }));
  return Object.freeze(ranges);
}
