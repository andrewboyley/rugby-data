import { expect, test } from "@playwright/test";
import { TimelineController } from "../src/TimelineController";
import type { TimelineLayout } from "../src/TimelineController";
import { createTemporalSupergraph } from "../src/graph/TemporalSupergraph";
import { TemporalAccumulator } from "../src/temporal/TemporalAccumulator";
import { TemporalIndex } from "../src/temporal/TemporalIndex";
import { MatchTimeline } from "../src/temporal/MatchTimeline";
import { createTemporalEdgeReducer, createTemporalNodeReducer } from "../src/graph/reducers";

const dataset = {
  games: [
    { eventId: 2, date: "2020-01-02T12:00:00Z", competitors: [{ teamId: 1, coachId: "9", roster: [{ playerId: 2, jersey: 1 }, { playerId: 3, jersey: 2 }] }] },
    { eventId: 3, date: "2020-01-02T18:00:00Z", competitors: [{ teamId: 3, roster: [{ playerId: 6, jersey: 1 }, { playerId: 7, jersey: 2 }] }] },
    { eventId: 1, date: "2020-01-01T12:00:00Z", competitors: [{ teamId: 1, coachId: "9", roster: [{ playerId: 1, jersey: 1 }, { playerId: 2, jersey: 2 }] }, { teamId: 2, roster: [{ playerId: 4, jersey: 1 }, { playerId: 5, jersey: 2 }] }] },
  ],
  players: { "1": "One", "2": "Two", "3": "Three", "4": "Four", "5": "Five" },
  coaches: { "9": "Coach" },
  teams: {},
};

function expectedEdgeMetrics(accumulator: TemporalAccumulator, targetTime: number): Map<string, { count: number; latest: number; winRate: number | null }> {
  const replay = new TemporalAccumulator(accumulator.timeline);
  const delta = replay.seek(targetTime);
  const edges = new Map<string, { count: number; latest: number; winRate: number | null }>();
  for (const edge of delta.addEdges) {
    if (edge.latest === undefined) throw new TypeError("accumulator edge delta must include latest");
    edges.set(`${edge.source},${edge.target}`, { count: edge.count, latest: edge.latest, winRate: edge.winRate ?? null });
  }
  for (const edge of delta.updateEdges) {
    if (edge.latest === undefined) throw new TypeError("accumulator edge delta must include latest");
    edges.set(`${edge.source},${edge.target}`, { count: edge.count, latest: edge.latest, winRate: edge.winRate ?? null });
  }
  return edges;
}

function expectTemporalIndexMatchesAccumulator(index: TemporalIndex, accumulator: TemporalAccumulator, targetTime: number): void {
  const expectedEdges = expectedEdgeMetrics(accumulator, targetTime);
  const activeNodes = index.nodeIds.filter((_, nodeIndex) => index.state.nodeActive[nodeIndex] === 1);
  const activeEdges = index.edgeRecords.filter((_, edgeIndex) => index.state.edgeActive[edgeIndex] === 1);

  expect(activeNodes.sort()).toEqual([...accumulator.playerCounts.keys()].sort());
  expect(activeEdges.map((edge) => edge.key).sort()).toEqual([...accumulator.pairCounts.keys()].sort());
  expect(index.state.nodeActive.reduce((total, active) => total + active, 0)).toBe(accumulator.playerCounts.size);
  expect(index.state.edgeActive.reduce((total, active) => total + active, 0)).toBe(accumulator.pairCounts.size);

  for (const [nodeId, count] of accumulator.playerCounts) {
    const nodeIndex = index.nodeIndexOf(nodeId);
    expect(index.state.nodeCounts[nodeIndex]).toBe(count);
    expect(index.state.nodeActive[nodeIndex]).toBe(1);
  }
  for (const [edgeKey, count] of accumulator.pairCounts) {
    const edgeIndex = index.edgeIndexOfKey(edgeKey);
    const expected = expectedEdges.get(edgeKey);
    expect(expected, edgeKey).toBeTruthy();
    expect(index.state.edgeCounts[edgeIndex]).toBe(count);
    expect(index.state.edgeLatest[edgeIndex]).toBe(expected?.latest);
    expect(index.state.edgeWinRateKnown[edgeIndex]).toBe(expected?.winRate == null ? 0 : 1);
    if (expected?.winRate != null) expect(index.state.edgeWinRate[edgeIndex]).toBe(expected.winRate);
  }
}

test("timeline is immutable, sorted, and creates one roster match per competitor", () => {
  const timeline = MatchTimeline.fromDataset(dataset);
  expect(timeline.matches.map((match) => [match.eventId, match.teamId, match.players])).toEqual([
    [1, 1, ["1", "2", "c_9"]],
    [1, 2, ["4", "5"]],
    [2, 1, ["2", "3", "c_9"]],
    [3, 3, ["6", "7"]],
  ]);
  expect(timeline.matches[2].timestamp).toBe(timeline.matches[3].timestamp);
  expect(timeline.matches[0].coachId).toBe("c_9");
  expect(Object.isFrozen(timeline.matches)).toBe(true);
  expect(Object.isFrozen(timeline.matches[0])).toBe(true);
});

test("timeline only includes competitors eligible under the legacy international-team mapping", () => {
  const timeline = MatchTimeline.fromDataset({
    games: [{ eventId: 1, date: "2020-01-01", competitors: [
      { teamId: 39, roster: [{ playerId: 1 }, { playerId: 2 }] },
      { teamId: 999, roster: [{ playerId: 3 }, { playerId: 4 }] },
    ] }],
  });
  expect(timeline.matches).toEqual([expect.objectContaining({ teamId: 39, players: ["1", "2"] })]);
});

test("timeline controller starts empty at dateMin or full at dateMax by constructor option", () => {
  const createLayout = (): TimelineLayout => ({ identity: 0, topologyReloads: 0, start: () => {}, kill: () => {} });
  const empty = new TimelineController(dataset, () => {}, () => {}, "min", createLayout);
  expect(empty.graph.order).toBeGreaterThan(0);
  expect(empty.activeNodeCount).toBe(0);
  expect(empty.activeEdgeCount).toBe(0);
  empty.dispose();
  const full = new TimelineController(dataset, () => {}, () => {}, "max", createLayout);
  expect(full.graph.order).toBeGreaterThan(0);
  expect(full.activeNodeCount).toBeGreaterThan(0);
  expect(full.currentTime).toBe(full.timeline.dateMax);
  full.dispose();
});

test("controller reset seeks live without replacing its continuous FA2 layout", () => {
  const layout: TimelineLayout = { identity: 0, topologyReloads: 0, start: () => {}, kill: () => {} };
  const controller = new TimelineController(dataset, () => {}, () => {}, "min", () => layout);
  controller.reset("max");
  expect(controller.layout).toBe(layout);
  expect(controller.currentTime).toBe(controller.timeline.dateMax);
  controller.reset("min");
  expect(controller.layout).toBe(layout);
  expect(controller.graph.order).toBeGreaterThan(0);
  expect(controller.activeNodeCount).toBe(0);
  controller.dispose();
});

test("seek is reversible, batches same-day matches, and reports only topology changes", () => {
  const timeline = MatchTimeline.fromDataset(dataset);
  const accumulator = new TemporalAccumulator(timeline);
  const first = accumulator.seek(timeline.matches[1].timestamp);
  expect(first.addNodes.sort()).toEqual(["1", "2", "4", "5", "c_9"]);
  expect(first.addEdges).toHaveLength(4);
  expect(first.updateEdges).toEqual([]);
  const snapshot = accumulator.snapshot();
  const second = accumulator.seek(timeline.matches[2].timestamp);
  expect(second.addNodes.sort()).toEqual(["3", "6", "7"]);
  expect(second.updateEdges.some((edge) => edge.count === 2)).toBe(true);
  accumulator.seek(timeline.matches[1].timestamp);
  expect(accumulator.snapshot()).toEqual(snapshot);
});

test("TemporalIndex preserves immutable union topology and matches accumulator state at every date", () => {
  const timeline = MatchTimeline.fromDataset(dataset);
  const index = new TemporalIndex(timeline);

  expect(Object.isFrozen(index.nodeIds)).toBe(true);
  expect(Object.isFrozen(index.edgeRecords)).toBe(true);
  expect(index.nodeIds).toContain("c_9");

  for (const targetTime of [Number.NEGATIVE_INFINITY, ...timeline.dates]) {
    const accumulator = new TemporalAccumulator(timeline);
    accumulator.seek(targetTime);
    index.seek(targetTime);
    expectTemporalIndexMatchesAccumulator(index, accumulator, targetTime);
  }
});

test("TemporalIndex matches accumulator state through deterministic forward and backward seeks", () => {
  const timeline = MatchTimeline.fromDataset({
    games: Array.from({ length: 12 }, (_, index) => ({
      eventId: index + 1,
      date: `2020-02-${String((index % 4) + 1).padStart(2, "0")}T${String(index).padStart(2, "0")}:00:00Z`,
      competitors: [{
        teamId: (index % 3) + 1,
        coachId: index % 2 ? null : index,
        roster: Array.from({ length: 3 + (index % 2) }, (_, player) => ({ playerId: (index + player) % 7 })),
      }],
    })),
    teams: {},
  });
  const index = new TemporalIndex(timeline);
  let randomState = 7;
  const targetTimes = Array.from({ length: 40 }, () => {
    randomState = (randomState * 1_103_515_245 + 12_345) >>> 0;
    return [Number.NEGATIVE_INFINITY, ...timeline.dates][randomState % (timeline.dates.length + 1)];
  });

  for (const targetTime of targetTimes) {
    const accumulator = new TemporalAccumulator(timeline);
    accumulator.seek(targetTime);
    index.seek(targetTime);
    expectTemporalIndexMatchesAccumulator(index, accumulator, targetTime);
  }
});

test("selected player reducer visibly focuses the player and direct neighborhood", () => {
  const timeline = MatchTimeline.fromDataset(dataset);
  const temporalIndex = new TemporalIndex(timeline);
  temporalIndex.seek(timeline.dateMax!);
  const graph = createTemporalSupergraph(dataset, temporalIndex).graph;
  const selectedId = "1";
  const state = {
    graph: () => graph,
    temporalIndex: () => temporalIndex,
    time: () => timeline.dateMax!,
    teamId: () => null,
    minMatchCount: () => 1,
    edgeColorMode: () => "shared" as const,
    selectedId: () => selectedId,
    partnerId: () => null,
    matchPlayerIds: () => null,
  };
  const nodeReducer = createTemporalNodeReducer(state);
  const edgeReducer = createTemporalEdgeReducer(state);
  expect(nodeReducer("1", { label: "One", color: "#111" } as never, graph.getNodeAttributes("1"))).toMatchObject({ label: "One", forceLabel: true });
  expect(nodeReducer("2", { label: "Two", color: "#222" } as never, graph.getNodeAttributes("2"))).toMatchObject({ label: "Two", forceLabel: true });
  expect(nodeReducer("5", { label: "Five", color: "#555" } as never, graph.getNodeAttributes("5"))).toMatchObject({ label: "", color: "#cbd5e1" });
  for (const edge of graph.edges()) {
    const [source, target] = graph.extremities(edge);
    expect(edgeReducer(edge, { color: "#111" } as never, graph.getEdgeAttributes(edge)).visibility).toBe(source === "1" || target === "1" ? "visible" : "hidden");
  }
  temporalIndex.seek(Number.NEGATIVE_INFINITY);
  const inactiveEdge = graph.edges()[0];
  expect(edgeReducer(inactiveEdge, { color: "#111" } as never, graph.getEdgeAttributes(inactiveEdge)).visibility).toBe("hidden");
});
