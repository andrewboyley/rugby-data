import { expect, test } from "@playwright/test";
import type Graph from "graphology";
import { TimelineController } from "../src/TimelineController";
import type { TimelineLayout } from "../src/TimelineController";
import {
  allTimeLayoutWeight,
  createTemporalSupergraph,
} from "../src/graph/TemporalSupergraph";
import { TemporalIndex } from "../src/temporal/TemporalIndex";
import { MatchTimeline } from "../src/temporal/MatchTimeline";

const dataset = {
  games: [
    { eventId: 2, date: "2020-01-02T12:00:00Z", competitors: [{ teamId: 1, coachId: "9", roster: [{ playerId: 2, jersey: 1 }, { playerId: 3, jersey: 2 }] }] },
    { eventId: 1, date: "2020-01-01T12:00:00Z", competitors: [{ teamId: 1, coachId: "9", roster: [{ playerId: 1, jersey: 1 }, { playerId: 2, jersey: 2 }] }, { teamId: 2, roster: [{ playerId: 4, jersey: 1 }, { playerId: 5, jersey: 2 }] }] },
  ],
  players: { "1": "One", "2": "Two", "3": "Three", "4": "Four", "5": "Five" },
  coaches: { "9": "Coach" },
  teams: {},
};

function graphSnapshot(graph: Graph): string {
  return JSON.stringify(graph.export());
}

test("temporal supergraph builds the complete immutable union with stable metadata", () => {
  const index = new TemporalIndex(MatchTimeline.fromDataset(dataset));
  const supergraph = createTemporalSupergraph(dataset, index);
  const coachIndex = index.nodeIndexOf("c_9");

  expect(supergraph.graph.order).toBe(index.nodeIds.length);
  expect(supergraph.graph.size).toBe(index.edgeRecords.length);
  expect(supergraph.graph.getNodeAttributes("c_9")).toMatchObject({
    label: "Coach",
    teams: [1],
    temporalIndex: coachIndex,
    allTimeCount: 2,
  });
  expect(supergraph.graph.getNodeAttributes("1")).toMatchObject({
    label: "One",
    teams: [1],
    temporalIndex: index.nodeIndexOf("1"),
  });
  expect(supergraph.graph.getNodeAttribute("1", "x")).toBe(supergraph.graph.getNodeAttribute("1", "x"));
  expect(supergraph.graph.getNodeAttribute("1", "y")).toBe(supergraph.graph.getNodeAttribute("1", "y"));
  for (const edge of supergraph.graph.edges()) {
    expect(supergraph.graph.getEdgeAttribute(edge, "temporalIndex")).toEqual(expect.any(Number));
    expect(supergraph.graph.getEdgeAttribute(edge, "weight")).toBeGreaterThan(0);
  }
});

test("timeline controller seeks only TemporalIndex state after the supergraph is ready", () => {
  let starts = 0;
  let kills = 0;
  const layout: TimelineLayout = {
    identity: 71,
    topologyReloads: 0,
    start: () => { starts += 1; },
    kill: () => { kills += 1; },
  };
  const controller = new TimelineController(dataset, () => {}, () => {}, "min", () => layout);
  const graph = controller.graph;
  const events = ["nodeAdded", "nodeDropped", "edgeAdded", "edgeDropped", "nodeAttributesUpdated", "edgeAttributesUpdated", "eachNodeAttributesUpdated", "eachEdgeAttributesUpdated"];
  let eventCount = 0;
  for (const event of events) graph.on(event, () => { eventCount += 1; });
  const initialSnapshot = graphSnapshot(graph);
  const initialOrder = graph.order;
  const initialSize = graph.size;
  const targets = [Number.NEGATIVE_INFINITY, ...controller.timeline.dates];

  expect(controller.currentTime).toBe(Number.NEGATIVE_INFINITY);
  expect(controller.activeNodeCount).toBe(0);
  expect(controller.activeEdgeCount).toBe(0);
  for (let seek = 0; seek < 100; seek += 1) controller.seek(targets[seek % targets.length]);

  expect(eventCount).toBe(0);
  expect(graph.order).toBe(initialOrder);
  expect(graph.size).toBe(initialSize);
  expect(graphSnapshot(graph)).toBe(initialSnapshot);
  expect(controller.layout).toBe(layout);
  expect(controller.layout.topologyReloads).toBe(0);
  expect(starts).toBe(1);
  controller.dispose();
  expect(kills).toBe(1);
});

test("timeline seeks preserve private FA2 topology, worker, and player positions", () => {
  let layoutGraph: Graph | null = null;
  let layoutCreations = 0;
  let starts = 0;
  let kills = 0;
  const layout: TimelineLayout = {
    identity: 72,
    topologyReloads: 0,
    start: () => { starts += 1; },
    kill: () => { kills += 1; },
  };
  const controller = new TimelineController(
    dataset,
    () => {},
    () => {},
    "min",
    (graph) => {
      layoutCreations += 1;
      layoutGraph = graph;
      return layout;
    },
  );

  expect(layoutGraph).not.toBeNull();
  expect(layoutGraph).not.toBe(controller.graph);
  expect(graphSnapshot(layoutGraph!)).toBe(graphSnapshot(controller.graph));
  for (const edge of layoutGraph!.edges()) {
    const count = Number(layoutGraph!.getEdgeAttribute(edge, "allTimeCount"));
    expect(layoutGraph!.getEdgeAttribute(edge, "weight")).toBe(
      allTimeLayoutWeight(count),
    );
  }

  const events = ["nodeAdded", "nodeDropped", "edgeAdded", "edgeDropped", "nodeAttributesUpdated", "edgeAttributesUpdated", "eachNodeAttributesUpdated", "eachEdgeAttributesUpdated"];
  let topologyEvents = 0;
  for (const event of events) layoutGraph!.on(event, () => { topologyEvents += 1; });
  layoutGraph!.setNodeAttribute("1", "x", 123.5);
  layoutGraph!.setNodeAttribute("1", "y", -456.25);
  const topologySnapshot = graphSnapshot(layoutGraph!);
  const playerPosition = {
    x: layoutGraph!.getNodeAttribute("1", "x"),
    y: layoutGraph!.getNodeAttribute("1", "y"),
  };
  topologyEvents = 0;

  const targets = [Number.NEGATIVE_INFINITY, ...controller.timeline.dates];
  for (let seek = 0; seek < 100; seek += 1) controller.seek(targets[seek % targets.length]);

  expect(layoutCreations).toBe(1);
  expect(controller.layout).toBe(layout);
  expect(controller.layout.identity).toBe(72);
  expect(controller.layout.topologyReloads).toBe(0);
  expect(starts).toBe(1);
  expect(topologyEvents).toBe(0);
  expect(graphSnapshot(layoutGraph!)).toBe(topologySnapshot);
  expect(layoutGraph!.getNodeAttribute("1", "x")).toBe(playerPosition.x);
  expect(layoutGraph!.getNodeAttribute("1", "y")).toBe(playerPosition.y);
  controller.dispose();
  expect(kills).toBe(1);
});
