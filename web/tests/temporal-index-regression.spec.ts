import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UndirectedGraph } from "graphology";
import { PersistentForceAtlas2 } from "../src/graph/PersistentForceAtlas2";
import { createTemporalSupergraph } from "../src/graph/TemporalSupergraph";
import { TemporalAccumulator } from "../src/temporal/TemporalAccumulator";
import { TemporalIndex } from "../src/temporal/TemporalIndex";
import { MatchTimeline } from "../src/temporal/MatchTimeline";

const dataset = {
  games: [
    { eventId: 2, date: "2020-01-02T12:00:00Z", competitors: [{ teamId: 1, coachId: "9", roster: [{ playerId: 2 }, { playerId: 3 }] }] },
    { eventId: 1, date: "2020-01-01T12:00:00Z", competitors: [{ teamId: 1, coachId: "9", roster: [{ playerId: 1 }, { playerId: 2 }] }, { teamId: 2, roster: [{ playerId: 4 }, { playerId: 5 }] }] },
  ],
  players: { "1": "One", "2": "Two", "3": "Three", "4": "Four", "5": "Five" },
  coaches: { "9": "Coach" },
  teams: {},
};

test("TemporalIndex rejects negative counts while retaining exact active counters", () => {
  const timeline = MatchTimeline.fromDataset(dataset);
  const accumulator = new TemporalAccumulator(timeline);
  const index = new TemporalIndex(timeline);
  const targetTime = timeline.dateMax ?? Number.NEGATIVE_INFINITY;

  expect(() => new TemporalAccumulator(timeline).applyMatch(timeline.matches[0], -1)).toThrow(RangeError);
  accumulator.seek(targetTime);
  index.seek(targetTime);
  expect(index.activeNodeCount).toBe(accumulator.playerCounts.size);
  expect(index.activeEdgeCount).toBe(accumulator.pairCounts.size);
});

test("supergraph topology and attributes remain fixed while TemporalIndex state reverses", () => {
  const index = new TemporalIndex(MatchTimeline.fromDataset(dataset));
  const graph = createTemporalSupergraph(dataset, index).graph;
  const snapshot = JSON.stringify(graph.export());

  index.seek(index.timeline.dateMax ?? Number.NEGATIVE_INFINITY);
  index.seek(Number.NEGATIVE_INFINITY);

  expect(graph.order).toBe(index.nodeIds.length);
  expect(graph.size).toBe(index.edgeRecords.length);
  expect(JSON.stringify(graph.export())).toBe(snapshot);
  expect(index.activeNodeCount).toBe(0);
  expect(index.activeEdgeCount).toBe(0);
});

test("persistent FA2 reloads matrices at a real topology worker boundary without stop/start", () => {
  let continuation: (() => void) | null = null;
  const graph = new UndirectedGraph();
  graph.addNode("a", { x: 0, y: 0, size: 1 });
  graph.addNode("b", { x: 1, y: 1, size: 1 });
  graph.addEdge("a", "b", { weight: 1 });
  const calls: string[] = [];
  let onMessage: ((event: MessageEvent<{ nodes: ArrayBuffer }>) => void) | undefined;
  const worker = { addEventListener: (_type: string, callback: typeof onMessage) => onMessage = callback, removeEventListener: () => {} };
  const layout = new PersistentForceAtlas2(graph, {
    create: () => ({ worker, start: () => calls.push("start"), kill: () => calls.push("kill"), askForIterations: (withEdges?: boolean) => calls.push(withEdges ? "reload" : "iterate") }),
    scheduler: { schedule: (callback) => { continuation = callback; return 40; }, cancel: () => {} },
  });
  layout.start();
  graph.addNode("c", { x: 2, y: 2, size: 1 });
  graph.addEdge("b", "c", { weight: 1 });
  onMessage?.(new MessageEvent("message", { data: { nodes: new ArrayBuffer(0) } }));

  expect(layout.topologyReloads).toBe(1);
  expect(calls).toEqual(["start"]);
  continuation?.();
  expect(calls).toEqual(["start", "reload"]);
  layout.kill();
  expect(calls).toEqual(["start", "reload", "kill"]);
});

test("persistent FA2 paces worker continuations and cancels the pending task on kill", () => {
  let continuation: (() => void) | null = null;
  const cancelledHandles: number[] = [];
  const graph = new UndirectedGraph();
  graph.addNode("a", { x: 0, y: 0, size: 1 });
  graph.addNode("b", { x: 1, y: 1, size: 1 });
  const calls: string[] = [];
  let onMessage: ((event: MessageEvent<{ nodes: ArrayBuffer }>) => void) | undefined;
  const worker = { addEventListener: (_type: string, callback: typeof onMessage) => onMessage = callback, removeEventListener: () => {} };
  const layout = new PersistentForceAtlas2(graph, {
    create: () => ({ worker, start: () => calls.push("start"), kill: () => calls.push("kill"), askForIterations: () => calls.push("iterate") }),
    scheduler: { schedule: (callback) => { continuation = callback; return 41; }, cancel: (handle) => cancelledHandles.push(handle) },
  });

  layout.start();
  onMessage?.(new MessageEvent("message", { data: { nodes: new Float32Array(20).buffer } }));

  expect(calls).toEqual(["start"]);
  expect(continuation).not.toBeNull();
  layout.kill();
  expect(cancelledHandles).toEqual([41]);
  continuation?.();
  expect(calls).toEqual(["start", "kill"]);
});

test("supergraph positions are deterministic and independent of Math.random", () => {
  const timeline = MatchTimeline.fromDataset(dataset);
  const first = createTemporalSupergraph(dataset, new TemporalIndex(timeline)).graph;
  const second = createTemporalSupergraph(dataset, new TemporalIndex(timeline)).graph;

  expect(first.export()).toEqual(second.export());
});

test("deterministic mixed seeks retain TemporalIndex active counts", () => {
  const timeline = MatchTimeline.fromDataset(dataset);
  const index = new TemporalIndex(timeline);
  const targets = [Number.NEGATIVE_INFINITY, ...timeline.dates];

  for (let seek = 0; seek < 100; seek += 1) {
    const target = targets[(seek * 7) % targets.length];
    const replay = new TemporalAccumulator(timeline);
    replay.seek(target);
    index.seek(target);
    expect(index.activeNodeCount).toBe(replay.playerCounts.size);
    expect(index.activeEdgeCount).toBe(replay.pairCounts.size);
  }
});

test("dateMax union topology and weights match the committed legacy fixture", () => {
  const fixturePath = resolve(fileURLToPath(new URL(".", import.meta.url)), "fixtures/temporal-dataset.json");
  const legacyPath = resolve(fileURLToPath(new URL(".", import.meta.url)), "fixtures/legacy-graph.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const legacy = JSON.parse(readFileSync(legacyPath, "utf8"));
  const timeline = MatchTimeline.fromDataset(fixture);
  const index = new TemporalIndex(timeline);
  const legacyEdges = [...legacy.edges, ...legacy.coachEdges] as Array<{ playerA?: string; playerB?: string; coachA?: string; coachB?: string; weight: number; dates: string[] }>;
  const edges = new Map(legacyEdges.map((edge) => {
    const source = edge.playerA ?? edge.coachA;
    const target = edge.playerB ?? edge.coachB;
    if (source === undefined || target === undefined) throw new TypeError("legacy edge must include endpoints");
    return [[source, target].sort().join(","), edge];
  }));

  expect(index.nodeIds).toEqual([...Object.keys(legacy.players), ...Object.keys(legacy.coachAppearances)].sort());
  expect(index.edgeRecords).toHaveLength(legacy.numEdges + legacy.coachEdges.length);
  index.edgeRecords.forEach((record, edgeIndex) => {
    const expected = edges.get(record.key);
    expect(expected, record.key).toBeTruthy();
    expect(index.allTimeEdgeCounts[edgeIndex]).toBe(expected?.weight);
    const dates = timeline.matches
      .filter((match) => match.players.includes(record.source) && match.players.includes(record.target))
      .map((match) => new Date(match.timestamp).toISOString().slice(0, 10));
    expect(dates.sort()).toEqual(expected?.dates);
  });
});
