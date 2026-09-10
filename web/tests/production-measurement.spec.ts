import { expect, test } from "@playwright/test";
import { performance } from "node:perf_hooks";
import { createTemporalSupergraph } from "../src/graph/TemporalSupergraph";
import { MatchTimeline } from "../src/temporal/MatchTimeline";
import { TemporalIndex } from "../src/temporal/TemporalIndex";

const PRODUCTION_NODES = 3_483;
const PRODUCTION_MATCHES = 300;
const ROSTER_SIZE = 34;
// Measured on the CI container with 3.4k nodes/90k+ edges. This leaves room
// for shared runners while catching accidental full-projection regressions.
const MAX_FULL_SEEK_MS = 20_000;

function productionDataset() {
  return {
    games: Array.from({ length: PRODUCTION_MATCHES }, (_, game) => ({
      eventId: game + 1,
      date: `2020-${String((game % 12) + 1).padStart(2, "0")}-${String((game % 28) + 1).padStart(2, "0")}T12:00:00Z`,
      competitors: [{ teamId: 39, roster: Array.from({ length: ROSTER_SIZE }, (_, player) => ({ playerId: (game * 97 + player * 131) % PRODUCTION_NODES })) }],
    })),
  };
}

test("production-sized temporal seek stays within the CI budget", () => {
  const timeline = MatchTimeline.fromDataset(productionDataset());
  const index = new TemporalIndex(timeline);
  const graph = createTemporalSupergraph(productionDataset(), index).graph;
  const start = performance.now();
  index.seek(timeline.dateMax ?? Number.NEGATIVE_INFINITY);
  const elapsed = performance.now() - start;

  expect(graph.order).toBeGreaterThan(3_000);
  expect(graph.size).toBeGreaterThan(90_000);
  expect(index.activeNodeCount).toBeGreaterThan(3_000);
  expect(index.activeEdgeCount).toBeGreaterThan(90_000);
  expect(elapsed).toBeLessThan(MAX_FULL_SEEK_MS);
});
