import { expect, test } from "@playwright/test";
import { PersistentNodeScene, ENTER_DURATION_MS, LEAVE_DURATION_MS } from "../src/scene/PersistentNodeScene";
import type { SceneNodeRecord } from "../src/scene/scene";
import { pairKey } from "../src/temporal/types";
import type { Delta, EdgeDelta } from "../src/temporal/types";

const records: readonly SceneNodeRecord[] = [
  { id: "p1", label: "Player 1", kind: "player", teams: [1] },
  { id: "p2", label: "Player 2", kind: "player", teams: [1] },
  { id: "p3", label: "Player 3", kind: "player", teams: [2] },
  { id: "c1", label: "Coach 1", kind: "coach", teams: [1] },
];

function makeDelta(overrides: Partial<Delta> = {}): Delta {
  return { addNodes: [], removeNodes: [], addEdges: [], updateEdges: [], removeEdges: [], ...overrides };
}

test("constructs with one slot per record and all nodes inactive", () => {
  const scene = new PersistentNodeScene(records, 0);
  expect(scene.nodeCount).toBe(4);
  expect(scene.getPhase("p1")).toBe("inactive");
  expect(scene.getPhase("c1")).toBe("inactive");
  expect(scene.slots.nodes.alpha[0]).toBe(0);
  expect(scene.slots.nodes.interactive[0]).toBe(0);
  expect(scene.hasActiveTransition()).toBe(false);
});

test("projectDelta marks added nodes as entering with correct initial visual state", () => {
  const scene = new PersistentNodeScene(records, 0);
  const patch = scene.projectDelta(makeDelta({ addNodes: ["p1", "c1"] }), 0);

  expect(scene.getPhase("p1")).toBe("entering");
  expect(scene.getPhase("c1")).toBe("entering");
  expect(scene.getPhase("p2")).toBe("inactive");
  expect(scene.hasActiveTransition()).toBe(true);

  const slot1 = scene.slots.nodes.slotById.get("p1")!;
  expect(patch.nodeSlots).toContain(slot1);
  expect(scene.slots.nodes.alpha[slot1]).toBe(0);
  expect(scene.slots.nodes.targetAlpha[slot1]).toBe(1);
  expect(scene.slots.nodes.scale[slot1]).toBeCloseTo(0.55, 5);
  expect(scene.slots.nodes.targetScale[slot1]).toBe(1);
  expect(scene.slots.nodes.interactive[slot1]).toBe(0);
  expect(scene.slots.nodes.transitioning[slot1]).toBe(1);
});

test("projectDelta marks removed nodes as leaving and makes them non-interactive", () => {
  const scene = new PersistentNodeScene(records, 0);
  scene.projectDelta(makeDelta({ addNodes: ["p1", "p2"] }), 0);
  scene.advanceTransitions(ENTER_DURATION_MS);

  expect(scene.getPhase("p1")).toBe("active");
  expect(scene.slots.nodes.interactive[scene.slots.nodes.slotById.get("p1")!]).toBe(1);

  const patch = scene.projectDelta(makeDelta({ removeNodes: ["p1"] }), ENTER_DURATION_MS);
  expect(scene.getPhase("p1")).toBe("leaving");
  expect(scene.hasActiveTransition()).toBe(true);
  expect(patch.nodeSlots).toContain(scene.slots.nodes.slotById.get("p1")!);
  expect(scene.slots.nodes.interactive[scene.slots.nodes.slotById.get("p1")!]).toBe(0);
});

test("advanceTransitions interpolates entering nodes and completes at ENTER_DURATION_MS", () => {
  const scene = new PersistentNodeScene(records, 0);
  scene.projectDelta(makeDelta({ addNodes: ["p1"] }), 0);

  const midPatch = scene.advanceTransitions(ENTER_DURATION_MS / 2);
  expect(scene.getPhase("p1")).toBe("entering");
  const slot = scene.slots.nodes.slotById.get("p1")!;
  expect(midPatch.nodeSlots).toContain(slot);
  expect(scene.slots.nodes.alpha[slot]).toBeGreaterThan(0);
  expect(scene.slots.nodes.alpha[slot]).toBeLessThan(1);
  expect(scene.slots.nodes.scale[slot]).toBeGreaterThan(0.55);
  expect(scene.slots.nodes.scale[slot]).toBeLessThan(1);
  expect(scene.slots.nodes.interactive[slot]).toBe(0);

  const completePatch = scene.advanceTransitions(ENTER_DURATION_MS);
  expect(scene.getPhase("p1")).toBe("active");
  expect(scene.slots.nodes.alpha[slot]).toBe(1);
  expect(scene.slots.nodes.scale[slot]).toBe(1);
  expect(scene.slots.nodes.interactive[slot]).toBe(1);
  expect(scene.slots.nodes.transitioning[slot]).toBe(1);
  expect(scene.hasActiveTransition()).toBe(false);
  expect(completePatch.nodeSlots).toContain(slot);
});

test("advanceTransitions interpolates leaving nodes and completes at LEAVE_DURATION_MS", () => {
  const scene = new PersistentNodeScene(records, 0);
  scene.projectDelta(makeDelta({ addNodes: ["p1"] }), 0);
  scene.advanceTransitions(ENTER_DURATION_MS);

  const leaveStart = ENTER_DURATION_MS;
  scene.projectDelta(makeDelta({ removeNodes: ["p1"] }), leaveStart);

  const midPatch = scene.advanceTransitions(leaveStart + LEAVE_DURATION_MS / 2);
  expect(scene.getPhase("p1")).toBe("leaving");
  const slot = scene.slots.nodes.slotById.get("p1")!;
  expect(scene.slots.nodes.alpha[slot]).toBeGreaterThan(0);
  expect(scene.slots.nodes.alpha[slot]).toBeLessThan(1);

  const completePatch = scene.advanceTransitions(leaveStart + LEAVE_DURATION_MS);
  expect(scene.getPhase("p1")).toBe("inactive");
  expect(scene.slots.nodes.alpha[slot]).toBe(0);
  expect(scene.slots.nodes.scale[slot]).toBeCloseTo(0.55, 5);
  expect(scene.slots.nodes.interactive[slot]).toBe(0);
  expect(scene.hasActiveTransition()).toBe(false);
  expect(completePatch.nodeSlots).toContain(slot);
});

test("leaving node is non-interactive immediately before transition completes", () => {
  const scene = new PersistentNodeScene(records, 0);
  scene.projectDelta(makeDelta({ addNodes: ["p1"] }), 0);
  scene.advanceTransitions(ENTER_DURATION_MS);

  const slot = scene.slots.nodes.slotById.get("p1")!;
  expect(scene.slots.nodes.interactive[slot]).toBe(1);

  scene.projectDelta(makeDelta({ removeNodes: ["p1"] }), ENTER_DURATION_MS);
  expect(scene.slots.nodes.interactive[slot]).toBe(0);
  expect(scene.slots.nodes.alpha[slot]).toBe(1);
});

test("returning player reuses existing slot and begins a new enter transition", () => {
  const scene = new PersistentNodeScene(records, 0);
  const slot = scene.slots.nodes.slotById.get("p1")!;

  scene.projectDelta(makeDelta({ addNodes: ["p1"] }), 0);
  scene.advanceTransitions(ENTER_DURATION_MS);
  expect(scene.getPhase("p1")).toBe("active");

  scene.projectDelta(makeDelta({ removeNodes: ["p1"] }), ENTER_DURATION_MS);
  scene.advanceTransitions(ENTER_DURATION_MS + LEAVE_DURATION_MS);
  expect(scene.getPhase("p1")).toBe("inactive");
  expect(scene.slots.nodes.alpha[slot]).toBe(0);

  scene.projectDelta(makeDelta({ addNodes: ["p1"] }), ENTER_DURATION_MS + LEAVE_DURATION_MS);
  expect(scene.getPhase("p1")).toBe("entering");
  expect(scene.slots.nodes.alpha[slot]).toBe(0);
  expect(scene.slots.nodes.targetAlpha[slot]).toBe(1);
});

test("beginEnter is ignored for already entering nodes", () => {
  const scene = new PersistentNodeScene(records, 0);
  const slot = scene.slots.nodes.slotById.get("p1")!;

  scene.projectDelta(makeDelta({ addNodes: ["p1"] }), 0);
  expect(scene.slots.nodes.alpha[slot]).toBe(0);

  const patch = scene.projectDelta(makeDelta({ addNodes: ["p1"] }), 10);
  expect(scene.getPhase("p1")).toBe("entering");
  expect(patch.nodeSlots).toHaveLength(0);
});

test("beginLeave is ignored for already leaving nodes", () => {
  const scene = new PersistentNodeScene(records, 0);
  scene.projectDelta(makeDelta({ addNodes: ["p1"] }), 0);
  scene.advanceTransitions(ENTER_DURATION_MS);

  scene.projectDelta(makeDelta({ removeNodes: ["p1"] }), ENTER_DURATION_MS);
  expect(scene.getPhase("p1")).toBe("leaving");

  const patch = scene.projectDelta(makeDelta({ removeNodes: ["p1"] }), ENTER_DURATION_MS + 10);
  expect(scene.getPhase("p1")).toBe("leaving");
  expect(patch.nodeSlots).toHaveLength(0);
});

test("multiple simultaneous adds produce dirty ranges covering all affected slots", () => {
  const scene = new PersistentNodeScene(records, 0);
  const patch = scene.projectDelta(makeDelta({ addNodes: ["p1", "p2", "p3", "c1"] }), 0);

  expect(patch.nodeSlots).toHaveLength(4);
  expect(patch.dirty.nodes.length).toBeGreaterThanOrEqual(1);
  expect(scene.activeNodes.size).toBe(4);
});

test("dispose clears all transitions and active nodes", () => {
  const scene = new PersistentNodeScene(records, 0);
  scene.projectDelta(makeDelta({ addNodes: ["p1", "p2"] }), 0);
  expect(scene.hasActiveTransition()).toBe(true);
  expect(scene.activeNodes.size).toBe(2);

  scene.dispose();
  expect(scene.hasActiveTransition()).toBe(false);
  expect(scene.activeNodes.size).toBe(0);
});

test("custom enter and leave durations are respected", () => {
  const scene = new PersistentNodeScene(records, 0, { enterDurationMs: 200, leaveDurationMs: 150 });
  scene.projectDelta(makeDelta({ addNodes: ["p1"] }), 0);

  scene.advanceTransitions(140);
  expect(scene.getPhase("p1")).toBe("entering");

  scene.advanceTransitions(200);
  expect(scene.getPhase("p1")).toBe("active");

  scene.projectDelta(makeDelta({ removeNodes: ["p1"] }), 200);
  scene.advanceTransitions(200 + 150);
  expect(scene.getPhase("p1")).toBe("inactive");
});

function edge(source: string, target: string, count = 1): EdgeDelta {
  return { source, target, count };
}

function edgeSlotOf(scene: PersistentNodeScene, source: string, target: string): number {
  const sourceSlot = scene.slots.nodes.slotById.get(source)!;
  const targetSlot = scene.slots.nodes.slotById.get(target)!;
  return scene.slots.edges.sourceSlots.findIndex(
    (value, index) => value === sourceSlot && scene.slots.edges.targetSlots[index] === targetSlot,
  );
}

test("projectDelta allocates addEdges into edge slots with enter state and edge patch", () => {
  const scene = new PersistentNodeScene(records, 2);
  const patch = scene.projectDelta(makeDelta({ addEdges: [edge("p1", "p2"), edge("p1", "p3")] }), 0);

  expect(scene.edgeCount).toBe(2);
  expect(scene.isEdgeResident(pairKey("p1", "p2"))).toBe(true);
  expect(scene.isEdgeResident(pairKey("p1", "p3"))).toBe(true);
  expect(scene.hasActiveTransition()).toBe(true);

  const p1Slot = scene.slots.nodes.slotById.get("p1")!;
  const p2Slot = scene.slots.nodes.slotById.get("p2")!;
  const slot = edgeSlotOf(scene, "p1", "p2");
  expect(scene.slots.edges.targetSlots[slot]).toBe(p2Slot);
  expect(patch.edgeSlots).toContain(slot);
  expect(scene.slots.edges.alpha[slot]).toBe(0);
  expect(scene.slots.edges.targetAlpha[slot]).toBe(1);
  expect(scene.slots.edges.scale[slot]).toBe(0.5 + Math.log2(2));
  expect(scene.slots.edges.interactive[slot]).toBe(0);
  expect(scene.slots.edges.transitioning[slot]).toBe(1);
  expect(scene.slots.edges.sourceSlots[slot]).toBe(p1Slot);
});

test("advanceTransitions interpolates and completes an entering edge", () => {
  const scene = new PersistentNodeScene(records, 2);
  scene.projectDelta(makeDelta({ addEdges: [edge("p1", "p2")] }), 0);

  const slot = scene.slots.edges.sourceSlots.findIndex((value) => value !== -1);
  const mid = scene.advanceTransitions(ENTER_DURATION_MS / 2);
  expect(scene.slots.edges.alpha[slot]).toBeGreaterThan(0);
  expect(scene.slots.edges.alpha[slot]).toBeLessThan(1);
  expect(mid.edgeSlots).toContain(slot);
  expect(scene.slots.edges.interactive[slot]).toBe(0);

  const done = scene.advanceTransitions(ENTER_DURATION_MS);
  expect(scene.slots.edges.alpha[slot]).toBe(1);
  expect(scene.slots.edges.interactive[slot]).toBe(1);
  expect(scene.slots.edges.transitioning[slot]).toBe(0);
  expect(scene.hasActiveTransition()).toBe(false);
  expect(done.edgeSlots).toContain(slot);
  expect(scene.isEdgeResident(pairKey("p1", "p2"))).toBe(true);
});

test("updateEdges refreshes a resident edge without allocating a second slot", () => {
  const scene = new PersistentNodeScene(records, 2);
  scene.projectDelta(makeDelta({ addEdges: [edge("p1", "p2", 1), edge("p1", "p3")] }), 0);

  const key = pairKey("p1", "p2");
  const slot = edgeSlotOf(scene, "p1", "p2");
  const patch = scene.projectDelta(makeDelta({ updateEdges: [edge("p1", "p2", 7)] }), 0);

  expect(scene.edgeCount).toBe(2);
  expect(scene.isEdgeResident(key)).toBe(true);
  expect(patch.edgeSlots).toContain(slot);
  expect(scene.slots.edges.scale[slot]).toBe(0.5 + Math.log2(8));
  expect(scene.slots.edges.alpha[slot]).toBe(1);
});

test("removeEdges fades the edge and frees its slot on completion", () => {
  const scene = new PersistentNodeScene(records, 2);
  const key = pairKey("p1", "p2");
  scene.projectDelta(makeDelta({ addEdges: [edge("p1", "p2")] }), 0);
  scene.advanceTransitions(ENTER_DURATION_MS);

  const slot = scene.slots.edges.sourceSlots.findIndex((value) => value === scene.slots.nodes.slotById.get("p1")!);
  const patch = scene.projectDelta(makeDelta({ removeEdges: [{ source: "p1", target: "p2" }] }), ENTER_DURATION_MS);
  expect(scene.edgeCount).toBe(1);
  expect(scene.slots.edges.interactive[slot]).toBe(0);
  expect(patch.edgeSlots).toContain(slot);

  scene.advanceTransitions(ENTER_DURATION_MS + LEAVE_DURATION_MS);
  expect(scene.edgeCount).toBe(0);
  expect(scene.isEdgeResident(key)).toBe(false);
  expect(scene.slots.edges.sourceSlots[slot]).toBe(-1);
  expect(scene.slots.edges.targetSlots[slot]).toBe(-1);
  expect(scene.slots.edges.alpha[slot]).toBe(0);
});

test("freed edge slot is reusable by a new edge", () => {
  const scene = new PersistentNodeScene(records, 2);
  const key = pairKey("p1", "p2");
  scene.projectDelta(makeDelta({ addEdges: [edge("p1", "p2"), edge("p1", "p3")] }), 0);
  scene.advanceTransitions(ENTER_DURATION_MS);
  scene.projectDelta(makeDelta({ removeEdges: [{ source: "p1", target: "p2" }] }), ENTER_DURATION_MS);
  scene.advanceTransitions(ENTER_DURATION_MS + LEAVE_DURATION_MS);

  const freedSlot = scene.slots.edges.sourceSlots.findIndex((value) => value === -1);
  scene.projectDelta(makeDelta({ addEdges: [edge("c1", "p2")] }), ENTER_DURATION_MS + LEAVE_DURATION_MS);
  expect(scene.edgeCount).toBe(2);
  expect(scene.isEdgeResident(key)).toBe(false);
  expect(scene.isEdgeResident(pairKey("c1", "p2"))).toBe(true);
  expect(scene.slots.edges.sourceSlots[freedSlot]).toBe(scene.slots.nodes.slotById.get("c1")!);
});

test("edge slots are bounded by capacity and overflow edges stay absent", () => {
  const scene = new PersistentNodeScene(records, 2);
  const minute = 0;
  scene.projectDelta(makeDelta({ addEdges: [edge("p1", "p2"), edge("p1", "p3"), edge("p3", "c1")] }), minute);

  expect(scene.edgeCount).toBe(2);
  expect(scene.isEdgeResident(pairKey("p1", "p2"))).toBe(true);
  expect(scene.isEdgeResident(pairKey("p1", "p3"))).toBe(true);
  expect(scene.isEdgeResident(pairKey("p3", "c1"))).toBe(false);
  scene.advanceTransitions(ENTER_DURATION_MS);
  expect(scene.edgeCount).toBe(2);
});

test("remove of a non-resident edge is a no-op", () => {
  const scene = new PersistentNodeScene(records, 1);
  scene.projectDelta(makeDelta({ addEdges: [edge("p1", "p2")] }), 0);

  const patch = scene.projectDelta(makeDelta({ removeEdges: [{ source: "p3", target: "c1" }] }), 0);
  expect(patch.edgeSlots).toHaveLength(0);
  expect(scene.edgeCount).toBe(1);
});

test("projectDisplay dims nodes not matching the team filter", () => {
  const scene = new PersistentNodeScene(records, 0);
  scene.projectDelta(makeDelta({ addNodes: ["p1", "p2", "p3"] }), 0);
  scene.advanceTransitions(ENTER_DURATION_MS);

  const patch = scene.projectDisplay({ filterTeamId: 1, selectedId: null, partnerId: null, matchPlayerIds: null });

  const p1Slot = scene.slots.nodes.slotById.get("p1")!;
  const p3Slot = scene.slots.nodes.slotById.get("p3")!;
  expect(scene.slots.nodes.targetAlpha[p1Slot]).toBe(1);
  expect(scene.slots.nodes.interactive[p1Slot]).toBe(1);
  expect(scene.slots.nodes.targetAlpha[p3Slot]).toBeCloseTo(0.15, 5);
  expect(scene.slots.nodes.interactive[p3Slot]).toBe(0);
  expect(patch.nodeSlots).toContain(p1Slot);
  expect(patch.nodeSlots).toContain(p3Slot);
});

test("projectDisplay emphasizes the selected node and dims the rest", () => {
  const scene = new PersistentNodeScene(records, 0);
  scene.projectDelta(makeDelta({ addNodes: ["p1", "p2"] }), 0);
  scene.advanceTransitions(ENTER_DURATION_MS);

  const patch = scene.projectDisplay({ filterTeamId: null, selectedId: "p1", partnerId: null, matchPlayerIds: null });

  const p1Slot = scene.slots.nodes.slotById.get("p1")!;
  const p2Slot = scene.slots.nodes.slotById.get("p2")!;
  expect(scene.slots.nodes.targetScale[p1Slot]).toBe(2);
  expect(scene.slots.nodes.targetAlpha[p1Slot]).toBe(1);
  expect(scene.slots.nodes.interactive[p1Slot]).toBe(1);
  expect(scene.slots.nodes.targetAlpha[p2Slot]).toBeCloseTo(0.15, 5);
  expect(scene.slots.nodes.interactive[p2Slot]).toBe(0);
  expect(patch.nodeSlots).toContain(p1Slot);
  expect(patch.nodeSlots).toContain(p2Slot);
});

test("projectDisplay keeps the partner highlighted alongside the selected node", () => {
  const scene = new PersistentNodeScene(records, 0);
  scene.projectDelta(makeDelta({ addNodes: ["p1", "p2"] }), 0);
  scene.advanceTransitions(ENTER_DURATION_MS);

  scene.projectDisplay({ filterTeamId: null, selectedId: "p1", partnerId: "p2", matchPlayerIds: null });

  const p1Slot = scene.slots.nodes.slotById.get("p1")!;
  const p2Slot = scene.slots.nodes.slotById.get("p2")!;
  expect(scene.slots.nodes.targetAlpha[p1Slot]).toBe(1);
  expect(scene.slots.nodes.targetAlpha[p2Slot]).toBe(1);
  expect(scene.slots.nodes.interactive[p2Slot]).toBe(1);
});

test("projectDisplay dims nodes outside the match player set", () => {
  const scene = new PersistentNodeScene(records, 0);
  scene.projectDelta(makeDelta({ addNodes: ["p1", "p2", "p3"] }), 0);
  scene.advanceTransitions(ENTER_DURATION_MS);

  scene.projectDisplay({
    filterTeamId: null,
    selectedId: null,
    partnerId: null,
    matchPlayerIds: new Set(["p1", "p2"]),
  });

  const p1Slot = scene.slots.nodes.slotById.get("p1")!;
  const p3Slot = scene.slots.nodes.slotById.get("p3")!;
  expect(scene.slots.nodes.targetAlpha[p1Slot]).toBe(1);
  expect(scene.slots.nodes.targetAlpha[p3Slot]).toBeCloseTo(0.15, 5);
  expect(scene.slots.nodes.interactive[p3Slot]).toBe(0);
});

test("projectDisplay filters edges whose endpoints miss the team filter", () => {
  const twoTeamRecords: readonly SceneNodeRecord[] = [
    { id: "p1", label: "Player 1", kind: "player", teams: [1] },
    { id: "p2", label: "Player 2", kind: "player", teams: [1] },
    { id: "p3", label: "Player 3", kind: "player", teams: [2] },
    { id: "p4", label: "Player 4", kind: "player", teams: [2] },
  ];
  const scene = new PersistentNodeScene(twoTeamRecords, 2);
  scene.projectDelta(makeDelta({ addEdges: [edge("p1", "p2"), edge("p3", "p4")] }), 0);
  scene.advanceTransitions(ENTER_DURATION_MS);

  scene.projectDisplay({ filterTeamId: 1, selectedId: null, partnerId: null, matchPlayerIds: null });

  const withinKey = pairKey("p1", "p2");
  const withoutKey = pairKey("p3", "p4");
  const withinSlot = edgeSlotOf(scene, "p1", "p2");
  const withoutSlot = edgeSlotOf(scene, "p3", "p4");
  expect(scene.isEdgeResident(withinKey)).toBe(true);
  expect(scene.isEdgeResident(withoutKey)).toBe(true);
  expect(scene.slots.edges.targetAlpha[withinSlot]).toBe(1);
  expect(scene.slots.edges.targetAlpha[withoutSlot]).toBeCloseTo(0.15, 5);
  expect(scene.slots.edges.interactive[withoutSlot]).toBe(0);
});

test("projectDisplay dims edges not fully inside the match player set", () => {
  const scene = new PersistentNodeScene(records, 2);
  scene.projectDelta(makeDelta({ addEdges: [edge("p1", "p2"), edge("p1", "p3")] }), 0);
  scene.advanceTransitions(ENTER_DURATION_MS);

  scene.projectDisplay({
    filterTeamId: null,
    selectedId: null,
    partnerId: null,
    matchPlayerIds: new Set(["p1", "p2"]),
  });

  const withinSlot = edgeSlotOf(scene, "p1", "p2");
  const withoutSlot = edgeSlotOf(scene, "p1", "p3");
  expect(scene.slots.edges.targetAlpha[withinSlot]).toBe(1);
  expect(scene.slots.edges.targetAlpha[withoutSlot]).toBeCloseTo(0.15, 5);
});

test("projectDisplay highlights the selected-partner edge and dims unrelated edges", () => {
  const scene = new PersistentNodeScene(records, 2);
  scene.projectDelta(makeDelta({ addEdges: [edge("p1", "p2"), edge("p1", "p3")] }), 0);
  scene.advanceTransitions(ENTER_DURATION_MS);

  scene.projectDisplay({ filterTeamId: null, selectedId: "p1", partnerId: "p2", matchPlayerIds: null });

  const withinSlot = edgeSlotOf(scene, "p1", "p2");
  const withoutSlot = edgeSlotOf(scene, "p1", "p3");
  expect(scene.slots.edges.targetAlpha[withinSlot]).toBe(1);
  expect(scene.slots.edges.targetAlpha[withoutSlot]).toBeCloseTo(0.15, 5);
});

test("projectDisplay is idempotent and ignores inactive and still-transitioning slots", () => {
  const scene = new PersistentNodeScene(records, 0);
  scene.projectDelta(makeDelta({ addNodes: ["p1"] }), 0);
  scene.advanceTransitions(ENTER_DURATION_MS);

  const display = { filterTeamId: null, selectedId: "p1", partnerId: null, matchPlayerIds: null };
  const patch1 = scene.projectDisplay(display);
  const beforePatch = scene.slots.nodes.slotById.get("p1")!;
  const before = scene.slots.nodes.targetScale[beforePatch];

  scene.projectDisplay(display);
  const afterPatch = scene.slots.nodes.slotById.get("p1")!;
  expect(scene.slots.nodes.targetScale[afterPatch]).toBe(before);
  expect(patch1.nodeSlots).toContain(afterPatch);

  const inactiveSlot = scene.slots.nodes.slotById.get("p3")!;
  expect(scene.slots.nodes.alpha[inactiveSlot]).toBe(0);

  scene.projectDelta(makeDelta({ addNodes: ["p3"] }), 0);
  scene.projectDisplay(display);
  expect(scene.slots.nodes.targetScale[scene.slots.nodes.slotById.get("p3")!]).toBe(1);
});

test("dispose clears resident edge slots and edge transitions", () => {
  const scene = new PersistentNodeScene(records, 2);
  scene.projectDelta(makeDelta({ addNodes: ["p1"], addEdges: [edge("p1", "p2"), edge("p1", "p3")] }), 0);
  expect(scene.isEdgeResident(pairKey("p1", "p2"))).toBe(true);
  expect(scene.hasActiveTransition()).toBe(true);

  scene.dispose();
  expect(scene.edgeCount).toBe(0);
  expect(scene.isEdgeResident(pairKey("p1", "p2"))).toBe(false);
  expect(scene.hasActiveTransition()).toBe(false);
});
