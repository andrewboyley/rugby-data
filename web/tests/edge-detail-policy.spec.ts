import { expect, test } from "@playwright/test";
import { projectBoundedEdges } from "../src/scene/edgeDetailPolicy";
import { PersistentNodeScene } from "../src/scene/PersistentNodeScene";
import type { SceneNodeRecord } from "../src/scene/scene";
import { pairKey } from "../src/temporal/types";
import type { EdgeDelta } from "../src/temporal/types";

const records: readonly SceneNodeRecord[] = [
  { id: "p1", label: "Player 1", kind: "player", teams: [1] },
  { id: "p2", label: "Player 2", kind: "player", teams: [1] },
  { id: "p3", label: "Player 3", kind: "player", teams: [2] },
  { id: "p4", label: "Player 4", kind: "player", teams: [2] },
];

const activeEdges: readonly EdgeDelta[] = Object.freeze([
  { source: "p3", target: "p4", count: 10 },
  { source: "p1", target: "p2", count: 1 },
  { source: "p1", target: "p3", count: 2 },
  { source: "p2", target: "p3", count: 3 },
]);

test("projects ranked ordinary edges while reserving selected, partner, and match context", () => {
  const projected = projectBoundedEdges(activeEdges, 1, {
    selectedId: "p1",
    partnerId: "p2",
    matchPlayerIds: new Set(["p2", "p3"]),
  });

  expect(projected.map((edge) => pairKey(edge.source, edge.target))).toEqual([
    "p2,p3",
    "p1,p3",
    "p1,p2",
    "p3,p4",
  ]);
  expect(activeEdges).toHaveLength(4);
  expect(activeEdges.find((edge) => pairKey(edge.source, edge.target) === "p3,p4")).toMatchObject({ count: 10 });
});

test("scene projects reserved edges beyond ordinary budget without owning temporal edge facts", () => {
  const scene = new PersistentNodeScene(records, 4);
  scene.projectEdges(activeEdges, 1, {
    selectedId: "p1",
    partnerId: "p2",
    matchPlayerIds: new Set(["p2", "p3"]),
  }, 0);

  expect(scene.edgeCount).toBe(4);
  expect(scene.isEdgeResident("p1,p2")).toBe(true);
  expect(scene.isEdgeResident("p1,p3")).toBe(true);
  expect(scene.isEdgeResident("p2,p3")).toBe(true);
  expect(activeEdges).toHaveLength(4);
});
