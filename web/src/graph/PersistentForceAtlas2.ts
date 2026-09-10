import FA2Layout from "graphology-layout-forceatlas2/worker.js";
import type Graph from "graphology";

type Matrix = { nodes: Float32Array; edges: Float32Array };
type Supervisor = {
  worker: unknown;
  start(): void;
  kill(): void;
  handleGraphUpdate?: () => void;
  handleMessage?: (event: MessageEvent<{ nodes: ArrayBuffer }>) => void;
  matrices?: Matrix;
  askForIterations?(withEdges?: boolean): void;
};

type ContinuationScheduler = {
  schedule(callback: () => void): number;
  cancel(handle: number): void;
};

type Options = {
  create?: (graph: Graph) => Supervisor;
  scheduler?: ContinuationScheduler;
};

const topologyEvents = ["nodeAdded", "nodeDropped", "edgeAdded", "edgeDropped", "edgeAttributesUpdated"] as const;
const iterationDelayMs = 100;
const iterationScheduler: ContinuationScheduler = {
  schedule: (callback) => window.setTimeout(callback, iterationDelayMs),
  cancel: (handle) => window.clearTimeout(handle),
};
let nextWorkerIdentity = 1;

/**
 * The upstream supervisor terminates its worker on graph topology events.
 * This adapter owns that message loop instead: a completed iteration is the
 * safe boundary at which it rebuilds matrices and sends them to the same
 * Worker. There is no stop/start gap and current graph positions seed reloads.
 */
export class PersistentForceAtlas2 {
  private readonly layout: Supervisor;
  private readonly scheduler: ContinuationScheduler;
  private readonly workerIdentity = nextWorkerIdentity++;
  private running = false;
  private topologyDirty = false;
  private reloads = 0;
  private continuationHandle: number | null = null;

  constructor(private readonly graph: Graph, options: Options = {}) {
    this.scheduler = options.scheduler ?? iterationScheduler;
    this.layout = options.create?.(graph) ?? new FA2Layout(graph, {
      getEdgeWeight: "weight",
      settings: { barnesHutOptimize: true, barnesHutTheta: 0.5, edgeWeightInfluence: 1, gravity: 1, scalingRatio: 10, slowDown: 1 },
    }) as unknown as Supervisor;
    // graphology-layout-forceatlas2 v0.10.1 respawns its worker from this
    // listener. Remove it before subscribing with our matrix-reload handler.
    if (this.layout.handleGraphUpdate) {
      for (const event of topologyEvents.slice(0, 4)) graph.removeListener(event, this.layout.handleGraphUpdate);
    }
    for (const event of topologyEvents) graph.on(event, this.markTopologyDirty);
    const worker = this.layout.worker as Worker | undefined;
    if (worker && this.layout.handleMessage) worker.removeEventListener("message", this.layout.handleMessage as EventListener);
    worker?.addEventListener("message", this.handleMessage as EventListener);
  }

  get worker(): unknown { return this.layout.worker; }
  get identity(): number { return this.workerIdentity; }
  get topologyReloads(): number { return this.reloads; }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.layout.start();
  }

  /** Marks a batched topology mutation for the next uninterrupted worker turn. */
  flushTopology(): void {
    // The worker's next message is the synchronization point. Calling stop()
    // here would discard an in-flight iteration and recreate the old behavior.
  }

  kill(): void {
    for (const event of topologyEvents) this.graph.removeListener(event, this.markTopologyDirty);
    this.running = false;
    if (this.continuationHandle !== null) this.scheduler.cancel(this.continuationHandle);
    this.continuationHandle = null;
    this.layout.kill();
  }

  private markTopologyDirty = (): void => { this.topologyDirty = true; };

  private handleMessage = (event: MessageEvent<{ nodes: ArrayBuffer }>): void => {
    if (!this.running) return;
    const nodes = new Float32Array(event.data.nodes);
    if (this.topologyDirty || nodes.length !== this.graph.order * 10) {
      this.topologyDirty = false;
      this.reloads += 1;
      this.layout.matrices = this.toMatrices();
      this.scheduleIterations(true);
      return;
    }
    let index = 0;
    this.graph.updateEachNodeAttributes((_node, attrs) => {
      attrs.x = nodes[index]!;
      attrs.y = nodes[index + 1]!;
      index += 10;
      return attrs;
    });
    if (this.layout.matrices) this.layout.matrices.nodes = nodes;
    this.scheduleIterations();
  };

  private scheduleIterations(withEdges = false): void {
    if (this.continuationHandle !== null) return;
    this.continuationHandle = this.scheduler.schedule(() => {
      this.continuationHandle = null;
      if (!this.running) return;
      if (withEdges) this.layout.askForIterations?.(true);
      else this.layout.askForIterations?.();
    });
  }

  private toMatrices(): Matrix {
    const index = new Map<string, number>();
    const nodes = new Float32Array(this.graph.order * 10);
    let offset = 0;
    this.graph.forEachNode((node, attrs) => {
      index.set(node, offset / 10);
      nodes[offset] = Number(attrs.x);
      nodes[offset + 1] = Number(attrs.y);
      nodes[offset + 6] = 1;
      nodes[offset + 7] = 1;
      nodes[offset + 8] = Number(attrs.size) || 1;
      nodes[offset + 9] = attrs.fixed ? 1 : 0;
      offset += 10;
    });
    const edges = new Float32Array(this.graph.size * 3);
    offset = 0;
    this.graph.forEachEdge((_edge, attrs, source, target) => {
      const weight = Number(attrs.weight) || 1;
      const sourceOffset = index.get(source)! * 10;
      const targetOffset = index.get(target)! * 10;
      nodes[sourceOffset + 6] += weight;
      nodes[targetOffset + 6] += weight;
      edges[offset] = index.get(source)!;
      edges[offset + 1] = index.get(target)!;
      edges[offset + 2] = weight;
      offset += 3;
    });
    return { nodes, edges };
  }
}
