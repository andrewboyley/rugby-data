import Graph from "graphology";
import type { FA2Params } from "./layout-optimizer";
import type { LayoutTickStats } from "./layout";
import { computeTickStats, sanitizePositions } from "./layout-utils";
import type { FeatureNormalizer } from "./layout-optimizer";
import { runForceAtlas2 } from "./forceatlas2-wrapper";
import type { ForceAtlas2SynchronousLayoutParameters } from "graphology-layout-forceatlas2";
import { assignUnitCircle } from "./graph-generator";

export type LayoutControllerOptions = {
  graph: Graph;
  settings: FA2Params;
  optimizer?: { featureView: (stat: LayoutTickStats) => ReturnType<FeatureNormalizer["normalize"]> };
};

export type LayoutStepResult = {
  stat: LayoutTickStats | null;
  positions: Map<string, { x: number; y: number }>;
  badNodes: number;
};

export class LayoutController {
  private graph: Graph;
  private settings: FA2Params;
  private optimizer?: { featureView: (stat: LayoutTickStats) => ReturnType<FeatureNormalizer["normalize"]> };
  private previousPositions: Map<string, { x: number; y: number }> = new Map();

  constructor(opts: LayoutControllerOptions) {
    this.graph = opts.graph;
    this.settings = opts.settings;
    this.optimizer = opts.optimizer;
  }

  updateSettings(settings: FA2Params) {
    this.settings = settings;
  }

  setGraph(graph: Graph) {
    this.graph = graph;
  }

  setOptimizer(optimizer: { featureView: (stat: LayoutTickStats) => ReturnType<FeatureNormalizer["normalize"]> }) {
    this.optimizer = optimizer;
  }

  resetToCircle() {
    assignUnitCircle(this.graph);
    this.previousPositions = this.savePositions();
  }

  step(): LayoutStepResult {
    const prev = this.previousPositions;
    const options: ForceAtlas2SynchronousLayoutParameters = { iterations: 2, settings: { ...this.settings, scalingRatio: 1, adjustSizes: true } };
    runForceAtlas2(this.graph, options);
    const badNodes = sanitizePositions(this.graph, prev);
    const stat = computeTickStats(this.graph, prev);
    if (stat && this.optimizer) {
      this.optimizer.featureView(stat);
    }
    this.previousPositions = this.savePositions();
    return { stat, positions: this.previousPositions, badNodes };
  }

  stepWithParams(params: FA2Params): LayoutStepResult {
    const prev = this.previousPositions;
    const options: ForceAtlas2SynchronousLayoutParameters = { iterations: 3, settings: { ...params, scalingRatio: 1, adjustSizes: true } };
    runForceAtlas2(this.graph, options);
    const badNodes = sanitizePositions(this.graph, prev);
    const stat = computeTickStats(this.graph, prev);
    this.previousPositions = this.savePositions();
    return { stat, positions: this.previousPositions, badNodes };
  }

  private savePositions(): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();
    this.graph.forEachNode((node: string, attrs: Record<string, unknown>) => {
      positions.set(node, { x: attrs.x as number, y: attrs.y as number });
    });
    return positions;
  }

  getPreviousPositions(): Map<string, { x: number; y: number }> {
    return this.previousPositions;
  }

  setPreviousPositions(positions: Map<string, { x: number; y: number }>) {
    this.previousPositions = positions;
  }

}
