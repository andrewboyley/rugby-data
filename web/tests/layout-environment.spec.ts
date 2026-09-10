import { expect, test } from "@playwright/test";
import Graph from "graphology";
import { LayoutEnvironment, Mulberry32, rawMetrics, normalizedMetrics, MAX_CROSSING_PAIR_SAMPLES, type Action, type LayoutScenario } from "../src/graph/layout-environment";
import { DiscreteBanditOptimizer } from "../src/graph/rl-bandit";
import { LayoutTrainer } from "../src/graph/layout-trainer";

const scenario: LayoutScenario = {
  graph: {
    nodes: [{ id: "c" }, { id: "a" }, { id: "b" }],
    edges: [{ source: "b", target: "a", weight: 2 }, { source: "c", target: "a" }],
  },
  seed: 17,
  initialPositionPolicy: { kind: "random", minX: -2, maxX: 2, minY: -1, maxY: 1 },
  fa2: { gravity: 0.1, slowDown: 1, scalingRatio: 1, strongGravityMode: true, barnesHutOptimize: true, barnesHutTheta: 0.5, edgeWeightInfluence: 1, outboundAttractionDistribution: true, linLogMode: false, adjustSizes: true },
  iterationsPerStep: 4,
  iterationHorizon: 8,
};

test("the same scenario and actions have identical topology, observations, rewards, and outcomes", () => {
  const actions: Action[] = [{ settings: { gravity: 0.2 } }, { settings: { slowDown: 2 } }];
  const first = new LayoutEnvironment(scenario);
  const second = new LayoutEnvironment(scenario);
  expect(first.scenario.graph).toEqual(second.scenario.graph);
  expect(first.startEpisode()).toEqual(second.startEpisode());
  expect(first.graph.export()).toEqual(second.graph.export());
  for (const action of actions) expect(first.step(action)).toEqual(second.step(action));
});

test("invalid FA2 actions are rejected before changing the graph", () => {
  const environment = new LayoutEnvironment(scenario);
  const baseline = environment.startEpisode();
  expect(() => environment.step({ settings: { gravity: Number.NaN } })).toThrow("gravity");
  expect(() => environment.step({ settings: { unknown: 1 } } as unknown as Action)).toThrow("unknown FA2 setting");
  expect(environment.startEpisode()).toEqual(baseline);
});

test("iterations per step accepts positive integers and applies them on the next step", () => {
  const environment = new LayoutEnvironment({ ...scenario, iterationHorizon: 10 });
  expect(() => environment.setIterationsPerStep(0)).toThrow("iterationsPerStep must be a positive integer");
  expect(() => environment.setIterationsPerStep(1.5)).toThrow("iterationsPerStep must be a positive integer");
  environment.setIterationsPerStep(3);
  expect(environment.step().observation.iterations).toBe(3);
});

test("reset restores the exact seeded baseline on the owned graph", () => {
  const environment = new LayoutEnvironment(scenario);
  const baseline = environment.startEpisode();
  environment.step();
  expect(environment.reset()).toEqual(baseline);
});

test("resetPositions reseeds coordinates on the same graph without changing topology or visual attributes", () => {
  const environment = new LayoutEnvironment({
    ...scenario,
    graph: {
      nodes: [{ id: "a", color: "#1098ad", size: 5 }, { id: "b", color: "#f59f00", size: 3 }],
      edges: [{ source: "a", target: "b", weight: 2, color: "#845ef7" }],
    },
  });
  const graph = environment.graph;
  const baselineTopology = graph.export();
  environment.startEpisode();
  environment.step();
  expect(graph.export()).not.toEqual(baselineTopology);

  environment.resetPositions();

  expect(environment.graph).toBe(graph);
  expect(graph.export()).toEqual(baselineTopology);
  expect(graph.getNodeAttributes("a")).toMatchObject({ color: "#1098ad", size: 5 });
  expect(graph.getNodeAttributes("b")).toMatchObject({ color: "#f59f00", size: 3 });
  expect(graph.getEdgeAttributes("edge:0")).toMatchObject({ color: "#845ef7", weight: 2 });
});


test("canonicalization and every reset preserve Sigma visual attributes", () => {
  const environment = new LayoutEnvironment({
    ...scenario,
    graph: {
      nodes: [{ id: "b", color: "#f59f00", size: 3 }, { id: "a", color: "#1098ad", size: 5 }],
      edges: [{ source: "b", target: "a", weight: 2, color: "#845ef7" }],
    },
  });
  expect(environment.scenario.graph).toEqual({
    nodes: [{ id: "a", color: "#1098ad", size: 5 }, { id: "b", color: "#f59f00", size: 3 }],
    edges: [{ source: "a", target: "b", weight: 2, color: "#845ef7" }],
  });
  for (const reset of [() => environment.startEpisode(), () => environment.reset()]) {
    reset();
    expect(environment.graph.getNodeAttributes("a")).toMatchObject({ color: "#1098ad", size: 5 });
    expect(environment.graph.getNodeAttributes("b")).toMatchObject({ color: "#f59f00", size: 3 });
    expect(environment.graph.getEdgeAttributes("edge:0")).toMatchObject({ color: "#845ef7", weight: 2 });
  }
});
test("empty, singleton, and disconnected graphs have safe explicit outcomes", () => {
  const empty = new LayoutEnvironment({ ...scenario, graph: { nodes: [], edges: [] } });
  expect(empty.step()).toMatchObject({ terminated: true, truncated: false, terminationReason: "empty" });
  const singleton = new LayoutEnvironment({ ...scenario, graph: { nodes: [{ id: "only" }], edges: [] }, convergenceThreshold: 0 });
  expect(singleton.step()).toMatchObject({ terminated: true, truncated: false, terminationReason: "no-dynamics" });
  const disconnected = new LayoutEnvironment({ ...scenario, graph: { nodes: [{ id: "a" }, { id: "b" }], edges: [] }, iterationHorizon: 4 });
  expect(disconnected.step()).toMatchObject({ terminated: true, truncated: false, terminationReason: "no-dynamics" });
});

test("trainer reaches a fixed iteration horizon independent of bounded run timing", () => {
  const makeTrainer = () => new LayoutTrainer({
    environment: new LayoutEnvironment({ ...scenario, iterationsPerStep: 3, iterationHorizon: 10 }),
    optimizer: new DiscreteBanditOptimizer({ random: new Mulberry32(4), calibrationSteps: 0 }),
    initialParams: scenario.fa2,
  });
  const oneStepAtATime = makeTrainer();
  const inOneBatch = makeTrainer();
  oneStepAtATime.start();
  inOneBatch.start();
  const token = oneStepAtATime.getRunToken();
  const gradual = [oneStepAtATime.run(1, token), oneStepAtATime.run(1, token), oneStepAtATime.run(1, token), oneStepAtATime.run(1, token)].flat();
  const batch = inOneBatch.run(4, inOneBatch.getRunToken());
  expect(gradual.at(-1)?.observation.iterations).toBe(10);
  expect(batch.at(-1)?.observation.iterations).toBe(10);
  expect(gradual.at(-1)).toMatchObject({ truncated: true, truncationReason: "iteration-horizon" });
  expect(batch.at(-1)).toMatchObject({ truncated: true, truncationReason: "iteration-horizon" });
});

test("calibration results are never recorded and reset invalidates stale run tokens", () => {
  const optimizer = new DiscreteBanditOptimizer({ random: new Mulberry32(9), calibrationSteps: 2 });
  optimizer.start(scenario.fa2);
  optimizer.recordEpisode(1);
  expect(optimizer.snapshot().episode).toBe(0);
  const trainer = new LayoutTrainer({
    environment: new LayoutEnvironment({ ...scenario, calibrationSteps: 2, iterationHorizon: 2 }),
    optimizer,
    initialParams: scenario.fa2,
  });
  const staleToken = trainer.start();
  const calibration = trainer.run(1, staleToken);
  expect(calibration[0]).toMatchObject({ calibrating: true, reward: null });
  expect(optimizer.snapshot().episode).toBe(0);
  trainer.reset();
  expect(trainer.run(2, staleToken)).toEqual([]);
  const fresh = trainer.start();
  const result = trainer.run(2, fresh);
  expect(result.at(-1)).toMatchObject({ truncated: true, truncationReason: "iteration-horizon" });
  expect(optimizer.snapshot().episode).toBe(0);
});

test("trainer observes every tick, calibrates before rewarding, and records completed episodes", () => {
  const calls = { observe: 0, reward: 0, recorded: [] as number[] };
  const optimizer = {
    start: () => undefined,
    chooseArm: (_context: number[] | null, current: typeof scenario.fa2) => current,
    observe: () => { calls.observe++; },
    isCalibrated: () => calls.observe >= 2,
    reward: () => { calls.reward++; return 0.75; },
    recordEpisode: (reward: number) => { calls.recorded.push(reward); },
  };
  const trainer = new LayoutTrainer({
    environment: new LayoutEnvironment({ ...scenario, iterationHorizon: 2 }),
    optimizer,
    initialParams: scenario.fa2,
  });
  const results = trainer.run(2, trainer.start());
  expect(calls.observe).toBe(2);
  expect(calls.reward).toBe(1);
  expect(results.map((result) => result.reward)).toEqual([null, 0.75]);
  expect(calls.recorded).toEqual([0.75]);
});

test("trainer forwards only the strict-best event emitted by the bandit", () => {
  const emitted = { params: { ...scenario.fa2, gravity: 0.3 }, reward: 0.8 };
  const strictBests: typeof emitted[] = [];
  let observations = 0;
  const rewards = [0.5, 0.5, 0.4, Number.NaN, 0.8];
  const optimizer = {
    start: () => undefined,
    chooseArm: (_context: number[] | null, current: typeof scenario.fa2) => current,
    observe: () => { observations++; },
    isCalibrated: () => observations !== 1,
    reward: () => rewards[observations - 1] ?? Number.NaN,
    recordEpisode: (reward: number) => reward === emitted.reward ? emitted : null,
  };
  const trainer = new LayoutTrainer({
    environment: new LayoutEnvironment({ ...scenario, iterationHorizon: 1 }),
    optimizer,
    initialParams: scenario.fa2,
    callbacks: { onStrictBest: (params: typeof scenario.fa2, reward: number) => { strictBests.push({ params, reward }); } },
  });
  const token = trainer.start();
  trainer.run(5, token);
  trainer.reset();
  trainer.run(1, token);

  expect(strictBests).toEqual([emitted]);
});

test("changing the iteration horizon restarts an active run and invalidates its old token", () => {
  const trainer = new LayoutTrainer({
    environment: new LayoutEnvironment({ ...scenario, iterationsPerStep: 2, iterationHorizon: 8 }),
    optimizer: new DiscreteBanditOptimizer({ calibrationSteps: 0 }),
    initialParams: scenario.fa2,
  });
  const first = trainer.start();
  trainer.run(1, first);
  const second = trainer.restart(3);
  expect(second).not.toBe(first);
  expect(trainer.run(1, first)).toEqual([]);
  expect(trainer.run(2, second).at(-1)).toMatchObject({
    observation: { iterations: 3 },
    truncated: true,
    truncationReason: "iteration-horizon",
  });
});

test("crossing metrics are exact for small graphs and deterministically bounded for large graphs", () => {
  const crossing = new Graph({ multi: false });
  for (const id of ["a", "b", "c", "d"]) crossing.addNode(id, { x: 0, y: 0 });
  crossing.setNodeAttribute("a", "x", 0); crossing.setNodeAttribute("a", "y", 0);
  crossing.setNodeAttribute("b", "x", 1); crossing.setNodeAttribute("b", "y", 1);
  crossing.setNodeAttribute("c", "x", 0); crossing.setNodeAttribute("c", "y", 1);
  crossing.setNodeAttribute("d", "x", 1); crossing.setNodeAttribute("d", "y", 0);
  crossing.addEdge("a", "b"); crossing.addEdge("c", "d");
  const exact = rawMetrics(crossing, {});
  expect(exact).toMatchObject({ edgeCrossings: 1, crossingPairs: 1, crossingSamples: 1 });
  expect(normalizedMetrics(exact).crossingFree).toBe(0);

  const large = new Graph({ multi: false });
  for (let index = 0; index < 96; index++) large.addNode(`${index}`, { x: index % 12, y: Math.floor(index / 12) });
  for (let index = 0; index < 96; index++) for (let offset = 1; offset <= 3; offset++) large.addEdge(`${index}`, `${(index + offset) % 96}`);
  const first = rawMetrics(large, {});
  const second = rawMetrics(large, {});
  expect(first).toEqual(second);
  expect(first.crossingSamples).toBeLessThanOrEqual(MAX_CROSSING_PAIR_SAMPLES);
  expect(first.crossingPairs).toBeGreaterThan(first.crossingSamples);
  expect(normalizedMetrics(first).crossingFree).toBeGreaterThanOrEqual(0);
});
