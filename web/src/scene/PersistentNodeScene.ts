import { pairKey, pairNodes } from "../temporal/types";
import type { NodeId, PairKey } from "../temporal/types";
import type { Delta, EdgeDelta } from "../temporal/types";
import { projectBoundedEdges } from "./edgeDetailPolicy";
import type { EdgeDetailContext } from "./edgeDetailPolicy";
import {
  createSceneSlotStorage,
  dirtyRanges,
  type SceneNodeRecord,
  type ScenePatch,
  type SceneSlotStorage,
  type PositionSnapshot,
} from "./scene";

export type NodeTransitionPhase = "inactive" | "entering" | "active" | "leaving";
export type EdgeTransitionPhase = "entering" | "active" | "leaving";

export type ActiveTransition = Readonly<{
  phase: "entering" | "leaving";
  startedAt: number;
  durationMs: number;
}>;

type NodeActiveTransition = ActiveTransition & Readonly<{
  startAlpha: number;
  startScale: number;
}>;

export type SceneDisplayContext = Readonly<{
  filterTeamId: number | null;
  selectedId: NodeId | null;
  partnerId: NodeId | null;
  matchPlayerIds: ReadonlySet<NodeId> | null;
}>;

export const ENTER_DURATION_MS = 140;
export const LEAVE_DURATION_MS = 100;

const INACTIVE_ALPHA = 0;
const INACTIVE_SCALE = 0.55;
const ACTIVE_ALPHA = 1;
const ACTIVE_SCALE = 1;
const DIM_ALPHA = 0.15;
const SELECTED_SCALE = 2;
const ACTIVE_EDGE_ALPHA = 1;
const MIN_EDGE_SCALE = 0.5;

export class PersistentNodeScene {
  readonly slots: SceneSlotStorage;
  readonly activeNodes: ReadonlySet<NodeId>;
  readonly nodePhases: ReadonlyMap<NodeId, NodeTransitionPhase>;

  private readonly slotById: ReadonlyMap<NodeId, number>;
  private readonly activeSet: Set<NodeId>;
  private readonly phaseMap: Map<NodeId, NodeTransitionPhase>;
  private readonly transitions: Map<NodeId, NodeActiveTransition>;
  private readonly enterDurationMs: number;
  private readonly leaveDurationMs: number;
  private readonly edgeSlotByKey: Map<PairKey, number>;
  private readonly edgeSlotKeys: (PairKey | null)[];
  private readonly freeEdgeSlots: number[];
  private readonly edgeTransitions: Map<PairKey, ActiveTransition>;
  private lastPositionSequence = 0;
  private hasPositionSnapshot = false;

  constructor(
    records: readonly SceneNodeRecord[],
    edgeCapacity: number,
    options?: { enterDurationMs?: number; leaveDurationMs?: number },
  ) {
    this.slots = createSceneSlotStorage(records, edgeCapacity);
    this.slotById = this.slots.nodes.slotById;
    this.activeSet = new Set();
    this.phaseMap = new Map();
    this.transitions = new Map();
    this.enterDurationMs = options?.enterDurationMs ?? ENTER_DURATION_MS;
    this.leaveDurationMs = options?.leaveDurationMs ?? LEAVE_DURATION_MS;

    for (const record of records) {
      this.phaseMap.set(record.id, "inactive");
    }

    this.edgeSlotByKey = new Map();
    this.edgeSlotKeys = new Array(this.slots.edges.capacity).fill(null);
    this.freeEdgeSlots = [];
    for (let slot = 0; slot < this.slots.edges.capacity; slot += 1) {
      this.freeEdgeSlots.push(slot);
    }
    this.edgeTransitions = new Map();

    this.activeNodes = this.activeSet;
    this.nodePhases = this.phaseMap;
  }

  get nodeCount(): number {
    return this.slots.nodes.records.length;
  }

  get edgeCount(): number {
    return this.edgeSlotByKey.size;
  }

  isEdgeResident(key: PairKey): boolean {
    return this.edgeSlotByKey.has(key);
  }

  projectDelta(delta: Delta, now: number): ScenePatch {
    const dirtyNodeSlots: number[] = [];
    const dirtyEdgeSlots: number[] = [];

    for (const nodeId of delta.removeNodes) {
      this.beginLeave(nodeId, now, dirtyNodeSlots);
    }

    for (const nodeId of delta.addNodes) {
      this.beginEnter(nodeId, now, dirtyNodeSlots);
    }

    for (const edge of delta.removeEdges) {
      this.beginEdgeLeave(edge, now, dirtyEdgeSlots);
    }

    for (const edge of delta.addEdges) {
      this.writeEdgeDetail(edge, now, dirtyEdgeSlots);
    }

    for (const edge of delta.updateEdges) {
      this.writeEdgeDetail(edge, now, dirtyEdgeSlots);
    }

    return {
      dirty: { nodes: dirtyRanges(dirtyNodeSlots), edges: dirtyRanges(dirtyEdgeSlots) },
      nodeSlots: dirtyNodeSlots,
      edgeSlots: dirtyEdgeSlots,
    };
  }

  projectEdges(
    activeEdges: readonly EdgeDelta[],
    ordinaryBudget: number,
    context: EdgeDetailContext,
    now: number,
  ): ScenePatch {
    const projected = projectBoundedEdges(activeEdges, ordinaryBudget, context);
    if (projected.length > this.slots.edges.capacity) {
      throw new RangeError("edge capacity cannot hold projected reserved edges");
    }

    const projectedKeys = new Set(projected.map((edge) => pairKey(edge.source, edge.target)));
    const dirtyEdgeSlots: number[] = [];
    for (const key of this.edgeSlotByKey.keys()) {
      if (!projectedKeys.has(key)) {
        const [source, target] = pairNodes(key);
        this.beginEdgeLeave({ source, target }, now, dirtyEdgeSlots);
      }
    }
    for (const edge of projected) {
      this.writeEdgeDetail(edge, now, dirtyEdgeSlots);
    }

    return {
      dirty: { nodes: [], edges: dirtyRanges(dirtyEdgeSlots) },
      edgeSlots: dirtyEdgeSlots,
    };
  }

  applyPositionSnapshot(snapshot: PositionSnapshot): ScenePatch {
    const nodeCount = this.slots.nodes.records.length;
    if (snapshot.sequence <= this.lastPositionSequence) {
      return { dirty: { nodes: [], edges: [] }, nodeSlots: [], edgeSlots: [] };
    }
    if (snapshot.positions.length !== nodeCount * 2) {
      throw new RangeError("position snapshot does not match scene node slots");
    }

    const nodeSlots: number[] = [];
    for (let slot = 0; slot < nodeCount; slot += 1) {
      const offset = slot * 2;
      const x = snapshot.positions[offset]!;
      const y = snapshot.positions[offset + 1]!;
      if (this.hasPositionSnapshot) {
        this.slots.nodes.previousX[slot] = this.slots.nodes.currentX[slot]!;
        this.slots.nodes.previousY[slot] = this.slots.nodes.currentY[slot]!;
      } else {
        this.slots.nodes.previousX[slot] = x;
        this.slots.nodes.previousY[slot] = y;
      }
      this.slots.nodes.currentX[slot] = x;
      this.slots.nodes.currentY[slot] = y;
      nodeSlots.push(slot);
    }
    this.hasPositionSnapshot = true;
    this.lastPositionSequence = snapshot.sequence;
    return { dirty: { nodes: dirtyRanges(nodeSlots), edges: [] }, nodeSlots, edgeSlots: [] };
  }

  interpolatePositions(progress: number): ScenePatch {
    const t = Math.max(0, Math.min(1, progress));
    const nodeSlots: number[] = [];
    for (let slot = 0; slot < this.slots.nodes.records.length; slot += 1) {
      this.slots.nodes.x[slot] = this.interpolate(
        this.slots.nodes.previousX[slot]!,
        this.slots.nodes.currentX[slot]!,
        t,
      );
      this.slots.nodes.y[slot] = this.interpolate(
        this.slots.nodes.previousY[slot]!,
        this.slots.nodes.currentY[slot]!,
        t,
      );
      nodeSlots.push(slot);
    }
    return { dirty: { nodes: dirtyRanges(nodeSlots), edges: [] }, nodeSlots, edgeSlots: [] };
  }

  projectDisplay(display: SceneDisplayContext): ScenePatch {
    const nodeSlots: number[] = [];
    const edgeSlots: number[] = [];

    for (const record of this.slots.nodes.records) {
      const phase = this.phaseMap.get(record.id);
      if (phase === undefined || phase === "inactive") continue;
      if (this.transitions.has(record.id)) continue;
      const slot = this.slotById.get(record.id);
      if (slot === undefined) continue;
      this.applyNodeDisplay(record, display, slot, nodeSlots);
    }

    for (const [key, slot] of this.edgeSlotByKey) {
      if (this.edgeTransitions.has(key)) continue;
      this.applyEdgeDisplay(pairNodes(key), display, slot, edgeSlots);
    }

    return {
      dirty: { nodes: dirtyRanges(nodeSlots), edges: dirtyRanges(edgeSlots) },
      nodeSlots,
      edgeSlots,
    };
  }

  advanceTransitions(now: number): ScenePatch {
    const dirtyNodeSlots: number[] = [];
    const completed: NodeId[] = [];

    for (const [nodeId, transition] of this.transitions) {
      const elapsed = now - transition.startedAt;
      if (elapsed >= transition.durationMs) {
        completed.push(nodeId);
        continue;
      }

      const t = elapsed / transition.durationMs;
      const slot = this.slotById.get(nodeId);
      if (slot === undefined) continue;

      if (transition.phase === "entering") {
        this.slots.nodes.alpha[slot] = this.interpolate(
          transition.startAlpha,
          ACTIVE_ALPHA,
          t,
        );
        this.slots.nodes.targetAlpha[slot] = ACTIVE_ALPHA;
        this.slots.nodes.scale[slot] = this.interpolate(
          transition.startScale,
          ACTIVE_SCALE,
          t,
        );
        this.slots.nodes.targetScale[slot] = ACTIVE_SCALE;
      } else {
        this.slots.nodes.alpha[slot] = this.interpolate(
          transition.startAlpha,
          INACTIVE_ALPHA,
          t,
        );
        this.slots.nodes.targetAlpha[slot] = INACTIVE_ALPHA;
        this.slots.nodes.scale[slot] = this.interpolate(
          transition.startScale,
          INACTIVE_SCALE,
          t,
        );
        this.slots.nodes.targetScale[slot] = INACTIVE_SCALE;
      }

      dirtyNodeSlots.push(slot);
    }

    for (const nodeId of completed) {
      const transition = this.transitions.get(nodeId)!;
      this.transitions.delete(nodeId);
      const slot = this.slotById.get(nodeId);
      if (slot === undefined) continue;

      if (transition.phase === "entering") {
        this.phaseMap.set(nodeId, "active");
        this.slots.nodes.alpha[slot] = ACTIVE_ALPHA;
        this.slots.nodes.targetAlpha[slot] = ACTIVE_ALPHA;
        this.slots.nodes.scale[slot] = ACTIVE_SCALE;
        this.slots.nodes.targetScale[slot] = ACTIVE_SCALE;
        this.slots.nodes.interactive[slot] = 1;
        this.slots.nodes.transitioning[slot] = 0;
      } else {
        this.phaseMap.set(nodeId, "inactive");
        this.slots.nodes.alpha[slot] = INACTIVE_ALPHA;
        this.slots.nodes.targetAlpha[slot] = INACTIVE_ALPHA;
        this.slots.nodes.scale[slot] = INACTIVE_SCALE;
        this.slots.nodes.targetScale[slot] = INACTIVE_SCALE;
        this.slots.nodes.interactive[slot] = 0;
        this.slots.nodes.transitioning[slot] = 0;
      }

      dirtyNodeSlots.push(slot);
    }

    const dirtyEdgeSlots: number[] = [];
    const completedEdges: PairKey[] = [];

    for (const [key, transition] of this.edgeTransitions) {
      const slot = this.edgeSlotByKey.get(key);
      if (slot === undefined) {
        completedEdges.push(key);
        continue;
      }
      const elapsed = now - transition.startedAt;
      if (elapsed >= transition.durationMs) {
        completedEdges.push(key);
        continue;
      }

      const t = elapsed / transition.durationMs;
      if (transition.phase === "entering") {
        this.slots.edges.alpha[slot] = t * ACTIVE_EDGE_ALPHA;
        this.slots.edges.targetAlpha[slot] = ACTIVE_EDGE_ALPHA;
      } else {
        this.slots.edges.alpha[slot] = ACTIVE_EDGE_ALPHA * (1 - t);
        this.slots.edges.targetAlpha[slot] = INACTIVE_ALPHA;
      }
      dirtyEdgeSlots.push(slot);
    }

    for (const key of completedEdges) {
      const transition = this.edgeTransitions.get(key)!;
      this.edgeTransitions.delete(key);
      const slot = this.edgeSlotByKey.get(key);
      if (slot === undefined) continue;

      if (transition.phase === "entering") {
        this.slots.edges.alpha[slot] = ACTIVE_EDGE_ALPHA;
        this.slots.edges.targetAlpha[slot] = ACTIVE_EDGE_ALPHA;
        this.slots.edges.interactive[slot] = 1;
        this.slots.edges.transitioning[slot] = 0;
        dirtyEdgeSlots.push(slot);
      } else {
        this.freeEdgeSlot(slot);
        dirtyEdgeSlots.push(slot);
      }
    }

    return {
      dirty: { nodes: dirtyRanges(dirtyNodeSlots), edges: dirtyRanges(dirtyEdgeSlots) },
      nodeSlots: dirtyNodeSlots,
      edgeSlots: dirtyEdgeSlots,
    };
  }

  private beginEnter(nodeId: NodeId, now: number, dirtySlots: number[]): void {
    const existing = this.transitions.get(nodeId);
    if (existing?.phase === "entering") return;

    const slot = this.slotById.get(nodeId);
    if (slot === undefined) return;

    if (this.phaseMap.get(nodeId) === "inactive") {
      this.slots.nodes.alpha[slot] = INACTIVE_ALPHA;
      this.slots.nodes.scale[slot] = INACTIVE_SCALE;
    }

    this.activeSet.add(nodeId);
    this.phaseMap.set(nodeId, "entering");
    this.transitions.set(nodeId, {
      phase: "entering",
      startedAt: now,
      durationMs: this.enterDurationMs,
      startAlpha: this.slots.nodes.alpha[slot],
      startScale: this.slots.nodes.scale[slot],
    });

    this.slots.nodes.targetAlpha[slot] = ACTIVE_ALPHA;
    this.slots.nodes.targetScale[slot] = ACTIVE_SCALE;
    this.slots.nodes.interactive[slot] = 0;
    this.slots.nodes.transitioning[slot] = 1;

    dirtySlots.push(slot);
  }

  private beginLeave(nodeId: NodeId, now: number, dirtySlots: number[]): void {
    const existing = this.transitions.get(nodeId);
    if (existing?.phase === "leaving") return;

    this.activeSet.delete(nodeId);
    this.phaseMap.set(nodeId, "leaving");

    const slot = this.slotById.get(nodeId);
    if (slot === undefined) return;

    this.transitions.set(nodeId, {
      phase: "leaving",
      startedAt: now,
      durationMs: this.leaveDurationMs,
      startAlpha: this.slots.nodes.alpha[slot],
      startScale: this.slots.nodes.scale[slot],
    });

    this.slots.nodes.interactive[slot] = 0;
    this.slots.nodes.transitioning[slot] = 1;

    dirtySlots.push(slot);
  }

  private writeEdgeDetail(edge: EdgeDelta, now: number, dirtySlots: number[]): void {
    const key = pairKey(edge.source, edge.target);
    const sourceSlot = this.slotById.get(edge.source);
    const targetSlot = this.slotById.get(edge.target);
    if (sourceSlot === undefined || targetSlot === undefined) return;

    const scale = this.edgeScaleFor(edge.count);
    const resident = this.edgeSlotByKey.get(key);
    if (resident !== undefined) {
      this.slots.edges.alpha[resident] = ACTIVE_EDGE_ALPHA;
      this.slots.edges.targetAlpha[resident] = ACTIVE_EDGE_ALPHA;
      this.slots.edges.scale[resident] = scale;
      this.slots.edges.targetScale[resident] = scale;
      this.slots.edges.interactive[resident] = 1;
      this.slots.edges.transitioning[resident] = 0;
      this.edgeTransitions.delete(key);
      dirtySlots.push(resident);
      return;
    }

    const existing = this.edgeTransitions.get(key);
    if (existing?.phase === "entering") {
      const inFlight = this.edgeSlotByKey.get(key);
      if (inFlight !== undefined) {
        this.slots.edges.scale[inFlight] = scale;
        this.slots.edges.targetScale[inFlight] = scale;
        dirtySlots.push(inFlight);
      }
      return;
    }

    const allocated = this.allocateEdgeSlot(key, sourceSlot, targetSlot);
    if (allocated === null) return;

    this.edgeTransitions.set(key, {
      phase: "entering",
      startedAt: now,
      durationMs: this.enterDurationMs,
    });
    this.slots.edges.alpha[allocated] = INACTIVE_ALPHA;
    this.slots.edges.targetAlpha[allocated] = ACTIVE_EDGE_ALPHA;
    this.slots.edges.scale[allocated] = scale;
    this.slots.edges.targetScale[allocated] = scale;
    this.slots.edges.interactive[allocated] = 0;
    this.slots.edges.transitioning[allocated] = 1;
    dirtySlots.push(allocated);
  }

  private beginEdgeLeave(edge: Pick<EdgeDelta, "source" | "target">, now: number, dirtySlots: number[]): void {
    const key = pairKey(edge.source, edge.target);
    const slot = this.edgeSlotByKey.get(key);
    if (slot === undefined) return;
    if (this.edgeTransitions.get(key)?.phase === "leaving") return;

    this.edgeTransitions.set(key, {
      phase: "leaving",
      startedAt: now,
      durationMs: this.leaveDurationMs,
    });
    this.slots.edges.interactive[slot] = 0;
    this.slots.edges.transitioning[slot] = 1;
    dirtySlots.push(slot);
  }

  private allocateEdgeSlot(key: PairKey, sourceSlot: number, targetSlot: number): number | null {
    const slot = this.freeEdgeSlots.pop();
    if (slot === undefined) return null;
    this.edgeSlotByKey.set(key, slot);
    this.edgeSlotKeys[slot] = key;
    this.slots.edges.sourceSlots[slot] = sourceSlot;
    this.slots.edges.targetSlots[slot] = targetSlot;
    return slot;
  }

  private freeEdgeSlot(slot: number): void {
    const key = this.edgeSlotKeys[slot];
    if (key !== null) this.edgeSlotByKey.delete(key);
    this.edgeSlotKeys[slot] = null;
    this.slots.edges.sourceSlots[slot] = -1;
    this.slots.edges.targetSlots[slot] = -1;
    this.slots.edges.alpha[slot] = INACTIVE_ALPHA;
    this.slots.edges.targetAlpha[slot] = INACTIVE_ALPHA;
    this.slots.edges.scale[slot] = 0;
    this.slots.edges.targetScale[slot] = 0;
    this.slots.edges.interactive[slot] = 0;
    this.slots.edges.transitioning[slot] = 0;
    this.freeEdgeSlots.push(slot);
  }

  private applyNodeDisplay(record: SceneNodeRecord, display: SceneDisplayContext, slot: number, dirtySlots: number[]): void {
    const dimmed = this.nodeIsDimmed(record, display);
    if (dimmed) {
      this.slots.nodes.targetAlpha[slot] = DIM_ALPHA;
      this.slots.nodes.targetScale[slot] = ACTIVE_SCALE;
      this.slots.nodes.interactive[slot] = 0;
    } else {
      this.slots.nodes.targetAlpha[slot] = ACTIVE_ALPHA;
      this.slots.nodes.targetScale[slot] = display.selectedId === record.id ? SELECTED_SCALE : ACTIVE_SCALE;
      this.slots.nodes.interactive[slot] = 1;
    }
    dirtySlots.push(slot);
  }

  private applyEdgeDisplay(pair: readonly [NodeId, NodeId], display: SceneDisplayContext, slot: number, dirtySlots: number[]): void {
    const dimmed = this.edgeIsDimmed(pair, display);
    this.slots.edges.targetAlpha[slot] = dimmed ? DIM_ALPHA : ACTIVE_EDGE_ALPHA;
    this.slots.edges.targetScale[slot] = this.slots.edges.scale[slot];
    this.slots.edges.interactive[slot] = dimmed ? 0 : 1;
    dirtySlots.push(slot);
  }

  private edgeScaleFor(count: number): number {
    return MIN_EDGE_SCALE + Math.log2(count + 1);
  }

  private interpolate(start: number, target: number, progress: number): number {
    return start + progress * (target - start);
  }

  private nodeIsDimmed(record: SceneNodeRecord, display: SceneDisplayContext): boolean {
    if (display.filterTeamId != null && !record.teams.includes(display.filterTeamId)) return true;
    if (display.matchPlayerIds != null && display.matchPlayerIds.size > 0 && !display.matchPlayerIds.has(record.id)) return true;
    if (
      display.selectedId != null &&
      record.id !== display.selectedId &&
      !(display.partnerId != null && record.id === display.partnerId)
    ) {
      return true;
    }
    return false;
  }

  private edgeIsDimmed(pair: readonly [NodeId, NodeId], display: SceneDisplayContext): boolean {
    const [source, target] = pair;
    const sourceRecord = this.slots.nodes.records[this.slotById.get(source) ?? -1];
    const targetRecord = this.slots.nodes.records[this.slotById.get(target) ?? -1];
    if (sourceRecord && targetRecord) {
      if (
        display.filterTeamId != null &&
        !sourceRecord.teams.includes(display.filterTeamId) &&
        !targetRecord.teams.includes(display.filterTeamId)
      ) {
        return true;
      }
      if (
        display.matchPlayerIds != null &&
        display.matchPlayerIds.size > 0 &&
        !(display.matchPlayerIds.has(source) && display.matchPlayerIds.has(target))
      ) {
        return true;
      }
    }
    if (display.selectedId != null) {
      if (display.partnerId != null) {
        return !(
          (source === display.selectedId && target === display.partnerId) ||
          (target === display.selectedId && source === display.partnerId)
        );
      }
      return source !== display.selectedId && target !== display.selectedId;
    }
    return false;
  }

  isTransitioning(nodeId: NodeId): boolean {
    return this.transitions.has(nodeId);
  }

  getPhase(nodeId: NodeId): NodeTransitionPhase {
    return this.phaseMap.get(nodeId) ?? "inactive";
  }

  hasActiveTransition(): boolean {
    return this.transitions.size > 0 || this.edgeTransitions.size > 0;
  }

  dispose(): void {
    this.transitions.clear();
    this.activeSet.clear();
    this.edgeTransitions.clear();
    for (let slot = 0; slot < this.edgeSlotKeys.length; slot += 1) {
      if (this.edgeSlotKeys[slot] !== null) {
        this.freeEdgeSlot(slot);
      }
    }
  }
}
