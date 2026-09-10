import Graph from "graphology";
import { runForceAtlas2 } from "./forceatlas2-wrapper";

export type Position = { x: number; y: number };

export type GraphNodeSpec = { id: string; color?: string; size?: number };
export type GraphEdgeSpec = { source: string; target: string; weight?: number; color?: string };

/** A serializable graph topology. Node IDs and edges are canonicalized on load. */
export type LayoutGraphSpec = {
  nodes: GraphNodeSpec[];
  edges: GraphEdgeSpec[];
};

export type InitialPositionPolicy =
  | { kind: "circle"; centerX?: number; centerY?: number; radius?: number }
  | { kind: "random"; minX?: number; maxX?: number; minY?: number; maxY?: number };

export type FA2Settings = {
  gravity: number;
  slowDown: number;
  scalingRatio: number;
  strongGravityMode: boolean;
  barnesHutOptimize: boolean;
  barnesHutTheta: number;
  edgeWeightInfluence: number;
  outboundAttractionDistribution: boolean;
  linLogMode: boolean;
  adjustSizes: boolean;
};

export type LayoutScenario = {
  graph: LayoutGraphSpec;
  seed: number;
  initialPositionPolicy: InitialPositionPolicy;
  fa2: FA2Settings;
  iterationsPerStep: number;
  iterationHorizon: number;
  convergenceThreshold?: number;
  /** Initial fixed steps used to calibrate an external reward normalizer. They never yield rewards. */
  calibrationSteps?: number;
};

export type Action = { settings?: Partial<FA2Settings> };

export type RawMetrics = {
  nodeCount: number;
  edgeCount: number;
  meanDisplacement: number;
  maxDisplacement: number;
  meanEdgeLength: number;
  edgeLengthCV: number;
  nodeSpread: number;
  aspectRatio: number;
  /** Estimated crossings for sampled graphs; exact when all pairs are checked. */
  edgeCrossings: number;
  /** Number of non-adjacent edge pairs that could geometrically cross. */
  crossingPairs: number;
  /** Number of eligible pairs actually checked. */
  crossingSamples: number;
};

export type NormalizedMetrics = {
  motion: number;
  edgeLengthUniformity: number;
  spread: number;
  aspectBalance: number;
  crossingFree: number;
};

export type Observation = {
  step: number;
  iterations: number;
  positions: Record<string, Position>;
  raw: RawMetrics;
  normalized: NormalizedMetrics;
};

export type TerminalReason = "empty" | "no-dynamics" | "converged";
export type TruncationReason = "iteration-horizon";

export type StepResult = {
  observation: Observation;
  /** Null for calibration and no-dynamics results. Such results must not train an agent. */
  reward: number | null;
  calibrating: boolean;
  terminated: boolean;
  truncated: boolean;
  terminationReason: TerminalReason | null;
  truncationReason: TruncationReason | null;
};

export interface SeededRandom {
  next(): number;
}

export type SeededRandomFactory = (seed: number) => SeededRandom;

export class Mulberry32 implements SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
}

const DEFAULT_SETTINGS: FA2Settings = {
  gravity: 0.1,
  slowDown: 1,
  scalingRatio: 1,
  strongGravityMode: true,
  barnesHutOptimize: true,
  barnesHutTheta: 0.5,
  edgeWeightInfluence: 1,
  outboundAttractionDistribution: true,
  linLogMode: false,
  adjustSizes: true,
};

const numericSettingBounds: Record<keyof Pick<FA2Settings, "gravity" | "slowDown" | "scalingRatio" | "barnesHutTheta" | "edgeWeightInfluence">, [number, number]> = {
  gravity: [0, 10],
  slowDown: [0.01, 100],
  scalingRatio: [0.01, 100],
  barnesHutTheta: [0.01, 2],
  edgeWeightInfluence: [0, 10],
};

function assertFiniteInRange(name: string, value: number, range: [number, number]): void {
  if (!Number.isFinite(value) || value < range[0] || value > range[1]) {
    throw new RangeError(`${name} must be a finite number in [${range[0]}, ${range[1]}]`);
  }
}

export function validateFA2Settings(settings: FA2Settings): FA2Settings {
  for (const [key, range] of Object.entries(numericSettingBounds)) {
    assertFiniteInRange(key, settings[key as keyof typeof numericSettingBounds], range);
  }
  for (const key of ["strongGravityMode", "barnesHutOptimize", "outboundAttractionDistribution", "linLogMode", "adjustSizes"] as const) {
    if (typeof settings[key] !== "boolean") throw new TypeError(`${key} must be a boolean`);
  }
  return { ...settings };
}

function cloneScenario(scenario: LayoutScenario): LayoutScenario {
  return JSON.parse(JSON.stringify(scenario)) as LayoutScenario;
}

function canonicalGraph(spec: LayoutGraphSpec): LayoutGraphSpec {
  const nodes = [...spec.nodes].map((node) => {
    if (node.color !== undefined && typeof node.color !== "string") throw new TypeError("node color must be a string");
    if (node.size !== undefined) assertFiniteInRange("node size", node.size, [0, Number.MAX_VALUE]);
    return { id: String(node.id), ...(node.color !== undefined ? { color: node.color } : {}), ...(node.size !== undefined ? { size: node.size } : {}) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) throw new Error("graph nodes must have unique IDs");
  const edgeKeys = new Set<string>();
  const edges = spec.edges.map((edge) => {
    const source = String(edge.source);
    const target = String(edge.target);
    if (!nodeIds.has(source) || !nodeIds.has(target)) throw new Error("edge endpoints must be graph nodes");
    if (source === target) throw new Error("self-loops are not supported");
    const key = source < target ? `${source}\u0000${target}` : `${target}\u0000${source}`;
    if (edgeKeys.has(key)) throw new Error("graph edges must be unique");
    edgeKeys.add(key);
    const weight = edge.weight ?? 1;
    assertFiniteInRange("edge weight", weight, [0, Number.MAX_VALUE]);
    if (edge.color !== undefined && typeof edge.color !== "string") throw new TypeError("edge color must be a string");
    const attributes = { weight, ...(edge.color !== undefined ? { color: edge.color } : {}) };
    return source < target ? { source, target, ...attributes } : { source: target, target: source, ...attributes };
  }).sort((a, b) => `${a.source}\u0000${a.target}`.localeCompare(`${b.source}\u0000${b.target}`));
  return { nodes, edges };
}

function canonicalPositionPolicy(policy: InitialPositionPolicy): InitialPositionPolicy {
  if (policy.kind === "circle") {
    const centerX = policy.centerX ?? 0;
    const centerY = policy.centerY ?? 0;
    const radius = policy.radius ?? 100;
    if (![centerX, centerY].every(Number.isFinite)) throw new RangeError("circle center must be finite");
    assertFiniteInRange("circle radius", radius, [0, Number.MAX_VALUE]);
    return { kind: "circle", centerX, centerY, radius };
  }
  const minX = policy.minX ?? -1;
  const maxX = policy.maxX ?? 1;
  const minY = policy.minY ?? -1;
  const maxY = policy.maxY ?? 1;
  if (![minX, maxX, minY, maxY].every(Number.isFinite) || minX > maxX || minY > maxY) throw new RangeError("random position bounds must be finite and ordered");
  return { kind: "random", minX, maxX, minY, maxY };
}

function validateScenario(scenario: LayoutScenario): LayoutScenario {
  if (!Number.isInteger(scenario.seed)) throw new TypeError("seed must be an integer");
  if (!Number.isInteger(scenario.iterationsPerStep) || scenario.iterationsPerStep < 1) throw new RangeError("iterationsPerStep must be a positive integer");
  if (!Number.isInteger(scenario.iterationHorizon) || scenario.iterationHorizon < 1) throw new RangeError("iterationHorizon must be a positive integer");
  if (scenario.convergenceThreshold !== undefined) assertFiniteInRange("convergenceThreshold", scenario.convergenceThreshold, [0, Number.MAX_VALUE]);
  if (scenario.calibrationSteps !== undefined && (!Number.isInteger(scenario.calibrationSteps) || scenario.calibrationSteps < 0)) throw new RangeError("calibrationSteps must be a non-negative integer");
  return {
    ...cloneScenario(scenario),
    seed: scenario.seed >>> 0,
    graph: canonicalGraph(scenario.graph),
    initialPositionPolicy: canonicalPositionPolicy(scenario.initialPositionPolicy),
    fa2: validateFA2Settings(scenario.fa2),
  };
}

function validateAction(action: Action): Partial<FA2Settings> {
  if (!action || typeof action !== "object" || Array.isArray(action)) throw new TypeError("action must be an object");
  if (action.settings === undefined) return {};
  if (!action.settings || typeof action.settings !== "object" || Array.isArray(action.settings)) throw new TypeError("action settings must be an object");
  for (const key of Object.keys(action.settings)) {
    if (!(key in DEFAULT_SETTINGS)) throw new Error(`unknown FA2 setting: ${key}`);
  }
  return action.settings;
}

function positions(graph: Graph): Record<string, Position> {
  const result: Record<string, Position> = {};
  graph.forEachNode((id, attrs) => {
    result[id] = { x: Number(attrs.x), y: Number(attrs.y) };
  });
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

function place(graph: Graph, policy: InitialPositionPolicy, random: SeededRandom): void {
  const ids = graph.nodes().sort();
  if (policy.kind === "circle") {
    const centerX = policy.centerX ?? 0;
    const centerY = policy.centerY ?? 0;
    const radius = policy.radius ?? 100;
    assertFiniteInRange("circle radius", radius, [0, Number.MAX_VALUE]);
    ids.forEach((id, index) => {
      const angle = ids.length === 1 ? 0 : (index * Math.PI * 2) / ids.length;
      graph.setNodeAttribute(id, "x", centerX + radius * Math.cos(angle));
      graph.setNodeAttribute(id, "y", centerY + radius * Math.sin(angle));
    });
    return;
  }
  const minX = policy.minX ?? -1;
  const maxX = policy.maxX ?? 1;
  const minY = policy.minY ?? -1;
  const maxY = policy.maxY ?? 1;
  for (const id of ids) {
    graph.setNodeAttribute(id, "x", minX + random.next() * (maxX - minX));
    graph.setNodeAttribute(id, "y", minY + random.next() * (maxY - minY));
  }
}

/** Exact crossing checks stop here; larger graphs use a deterministic bounded sample. */
export const MAX_CROSSING_PAIR_SAMPLES = 2_048;
const MAX_EXACT_CROSSING_EDGES = 64;

function pairIndexToEdges(index: number, edgeCount: number): [number, number] {
  let low = 0;
  let high = edgeCount - 2;
  while (low <= high) {
    const first = Math.floor((low + high) / 2);
    const start = (first * (2 * edgeCount - first - 1)) / 2;
    const next = ((first + 1) * (2 * edgeCount - first - 2)) / 2;
    if (index < start) high = first - 1;
    else if (index >= next) low = first + 1;
    else return [first, first + 1 + index - start];
  }
  throw new RangeError("invalid edge-pair index");
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function crossingSeed(edges: Array<{ source: string; target: string }>): number {
  let hash = 2_166_136_261;
  for (const edge of edges) {
    for (const char of `${edge.source}\u0000${edge.target}\u0001`) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16_777_619);
    }
  }
  return hash >>> 0;
}

export function rawMetrics(graph: Graph, previous: Record<string, Position>): RawMetrics {
  const current = positions(graph);
  const ids = Object.keys(current);
  const distances = ids.map((id) => {
    const before = previous[id] ?? current[id];
    return Math.hypot(current[id].x - before.x, current[id].y - before.y);
  });
  const meanDisplacement = distances.length ? distances.reduce((sum, value) => sum + value, 0) / distances.length : 0;
  const maxDisplacement = distances.length ? Math.max(...distances) : 0;
  const lengths: number[] = [];
  graph.forEachEdge((_edge, _attributes, source, target) => {
    lengths.push(Math.hypot(current[source].x - current[target].x, current[source].y - current[target].y));
  });
  const meanEdgeLength = lengths.length ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length : 0;
  const edgeLengthCV = meanEdgeLength ? Math.sqrt(lengths.reduce((sum, value) => sum + (value - meanEdgeLength) ** 2, 0) / lengths.length) / meanEdgeLength : 0;
  const meanX = ids.length ? ids.reduce((sum, id) => sum + current[id].x, 0) / ids.length : 0;
  const meanY = ids.length ? ids.reduce((sum, id) => sum + current[id].y, 0) / ids.length : 0;
  const nodeSpread = ids.length ? Math.sqrt(ids.reduce((sum, id) => sum + (current[id].x - meanX) ** 2 + (current[id].y - meanY) ** 2, 0) / ids.length) : 0;
  const xs = ids.map((id) => current[id].x);
  const ys = ids.map((id) => current[id].y);
  const width = ids.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const height = ids.length ? Math.max(...ys) - Math.min(...ys) : 0;
  const edges: Array<{ source: string; target: string }> = [];
  graph.forEachEdge((_edge, _attributes, source, target) => edges.push({ source, target }));
  const degreePairs = ids.reduce((sum, id) => {
    const degree = graph.degree(id);
    return sum + (degree * (degree - 1)) / 2;
  }, 0);
  const crossingPairs = Math.max(0, (edges.length * (edges.length - 1)) / 2 - degreePairs);
  const orientation = (a: Position, b: Position, c: Position) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const crosses = (first: number, second: number): boolean => {
    const a = edges[first];
    const b = edges[second];
    if (a.source === b.source || a.source === b.target || a.target === b.source || a.target === b.target) return false;
    const abC = orientation(current[a.source], current[a.target], current[b.source]);
    const abD = orientation(current[a.source], current[a.target], current[b.target]);
    const cdA = orientation(current[b.source], current[b.target], current[a.source]);
    const cdB = orientation(current[b.source], current[b.target], current[a.target]);
    return abC * abD < 0 && cdA * cdB < 0;
  };
  let crossingSamples = 0;
  let observedCrossings = 0;
  if (edges.length <= MAX_EXACT_CROSSING_EDGES) {
    for (let first = 0; first < edges.length; first++) for (let second = first + 1; second < edges.length; second++) {
      const a = edges[first];
      const b = edges[second];
      if (a.source === b.source || a.source === b.target || a.target === b.source || a.target === b.target) continue;
      crossingSamples++;
      if (crosses(first, second)) observedCrossings++;
    }
  } else if (crossingPairs > 0) {
    // A topology-seeded permutation keeps this repeatable and bounded by the sample cap.
    const totalPairs = (edges.length * (edges.length - 1)) / 2;
    const target = Math.min(MAX_CROSSING_PAIR_SAMPLES, crossingPairs);
    const seed = crossingSeed(edges);
    let stride = ((seed >>> 1) | 1) % totalPairs || 1;
    while (gcd(stride, totalPairs) !== 1) stride = (stride + 2) % totalPairs || 1;
    for (let attempt = 0, index = seed % totalPairs; crossingSamples < target && attempt < target * 16; attempt++, index = (index + stride) % totalPairs) {
      const [first, second] = pairIndexToEdges(index, edges.length);
      const a = edges[first];
      const b = edges[second];
      if (a.source === b.source || a.source === b.target || a.target === b.source || a.target === b.target) continue;
      crossingSamples++;
      if (crosses(first, second)) observedCrossings++;
    }
  }
  const edgeCrossings = crossingSamples ? observedCrossings * crossingPairs / crossingSamples : 0;
  return { nodeCount: ids.length, edgeCount: graph.size, meanDisplacement, maxDisplacement, meanEdgeLength, edgeLengthCV, nodeSpread, aspectRatio: height ? width / height : 1, edgeCrossings, crossingPairs, crossingSamples };
}

export function normalizedMetrics(raw: RawMetrics): NormalizedMetrics {
  return {
    motion: 1 / (1 + raw.meanDisplacement),
    edgeLengthUniformity: 1 / (1 + raw.edgeLengthCV),
    spread: 1 - Math.exp(-raw.nodeSpread),
    aspectBalance: 1 / (1 + Math.abs(raw.aspectRatio - 1)),
    crossingFree: raw.crossingPairs ? Math.max(0, 1 - raw.edgeCrossings / raw.crossingPairs) : 1,
  };
}

export class LayoutEnvironment {
  readonly graph = new Graph({ multi: false });
  readonly scenario: LayoutScenario;
  private settings: FA2Settings;
  private readonly randomFactory: SeededRandomFactory;
  private stepCount = 0;
  private iterations = 0;
  private closed = false;

  constructor(scenario: LayoutScenario, randomFactory: SeededRandomFactory = (seed) => new Mulberry32(seed)) {
    this.scenario = validateScenario(scenario);
    this.settings = { ...this.scenario.fa2 };
    this.randomFactory = randomFactory;
    this.reset();
  }

  reset(): Observation {
    this.assertOpen();
    this.graph.clear();
    for (const node of this.scenario.graph.nodes) this.graph.addNode(node.id, { x: 0, y: 0, ...(node.color ? { color: node.color } : {}), ...(node.size !== undefined ? { size: node.size } : {}) });
    this.scenario.graph.edges.forEach((edge, index) => {
      this.graph.addEdgeWithKey(`edge:${index}`, edge.source, edge.target, { weight: edge.weight, ...(edge.color ? { color: edge.color } : {}) });
    });
    place(this.graph, this.scenario.initialPositionPolicy, this.randomFactory(this.scenario.seed));
    this.settings = { ...this.scenario.fa2 };
    this.stepCount = 0;
    this.iterations = 0;
    return this.observation(positions(this.graph));
  }

  startEpisode(): Observation {
    return this.reset();
  }

  resetPositions(): void {
    this.assertOpen();
    place(this.graph, this.scenario.initialPositionPolicy, this.randomFactory(this.scenario.seed));
  }

  setIterationHorizon(iterationHorizon: number): void {
    if (!Number.isInteger(iterationHorizon) || iterationHorizon < 1) throw new RangeError("iterationHorizon must be a positive integer");
    this.scenario.iterationHorizon = iterationHorizon;
  }

  setIterationsPerStep(iterationsPerStep: number): void {
    if (!Number.isInteger(iterationsPerStep) || iterationsPerStep < 1) throw new RangeError("iterationsPerStep must be a positive integer");
    this.scenario.iterationsPerStep = iterationsPerStep;
  }

  step(action: Action = {}): StepResult {
    this.assertOpen();
    const settings = validateFA2Settings({ ...this.settings, ...validateAction(action) });
    const before = positions(this.graph);
    const empty = this.graph.order === 0;
    const noDynamics = !empty && (this.graph.order === 1 || this.graph.size === 0);
    if (empty || noDynamics) {
      const observation = this.observation(before);
      return {
        observation,
        reward: null,
        calibrating: false,
        terminated: true,
        truncated: false,
        terminationReason: empty ? "empty" : "no-dynamics",
        truncationReason: null,
      };
    }
    const iterations = Math.min(this.scenario.iterationsPerStep, this.scenario.iterationHorizon - this.iterations);
    if (iterations > 0) runForceAtlas2(this.graph, { iterations, settings: { ...settings, scalingRatio: 1, adjustSizes: true } });
    this.settings = settings;
    this.stepCount++;
    this.iterations += iterations;
    const observation = this.observation(before);
    const converged = observation.raw.maxDisplacement <= (this.scenario.convergenceThreshold ?? 0);
    const truncated = !converged && this.iterations >= this.scenario.iterationHorizon;
    const calibrating = this.stepCount <= (this.scenario.calibrationSteps ?? 0);
    const normalized = observation.normalized;
    return {
      observation,
      reward: calibrating ? null : (normalized.motion + normalized.edgeLengthUniformity + normalized.spread + normalized.aspectBalance + normalized.crossingFree) / 5,
      calibrating,
      terminated: converged,
      truncated,
      terminationReason: converged ? "converged" : null,
      truncationReason: truncated ? "iteration-horizon" : null,
    };
  }

  close(): void {
    if (this.closed) return;
    this.graph.clear();
    this.closed = true;
  }

  private observation(previous: Record<string, Position>): Observation {
    const raw = rawMetrics(this.graph, previous);
    return { step: this.stepCount, iterations: this.iterations, positions: positions(this.graph), raw, normalized: normalizedMetrics(raw) };
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("LayoutEnvironment is closed");
  }
}

export { DEFAULT_SETTINGS };
