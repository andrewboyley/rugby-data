import Graph from "graphology";
import type { LayoutTickStats } from "./layout";
import type { FA2Params } from "./layout-optimizer";
import type { LayoutController, OptimizerFacade, StrictBestEvent } from "./index";
import { LayoutEnvironment, type LayoutScenario, type StepResult } from "./layout-environment";

/** Headless episode result. Calibration and invalid episodes have `reward: null`. */
export type TrainerEpisodeResult = StepResult & {
  params: FA2Params;
  episode: number;
};

export interface TrainerCallbacks {
  onEpisodeComplete: (params: FA2Params, reward: number, context: number[] | null) => void;
  onEpisodeStart: (params: FA2Params) => void;
  onIteration: (stat: LayoutTickStats, iteration: number) => void;
  onStatsUpdate: (stats: TrainerStats) => void;
  onStrictBest: (params: FA2Params, reward: number) => void;
  /** Receives terminal, truncated, calibration, and no-dynamics outcomes. */
  onEpisodeResult?: (result: TrainerEpisodeResult) => void;
}

export interface TrainerStats {
  totalEpisodes: number;
  episodesPerSec: number;
  lastEpisodeReward: number;
  bestReward: number;
  trainingTime: number;
  iterationsPerSec: number;
}

type CoreOptimizer = Pick<OptimizerFacade, "chooseArm"> & {
  recordEpisode(reward: number, context: number[] | null): StrictBestEvent | null | void;
} & Partial<Pick<OptimizerFacade, "start" | "getSnapshot" | "observe" | "reward" | "isCalibrated">>;

/** Preferred API. `run` is deliberately bounded and has no scheduler or clock dependency. */
export interface EnvironmentTrainerOptions {
  environment: LayoutEnvironment;
  optimizer: CoreOptimizer;
  initialParams: FA2Params;
  callbacks?: Partial<TrainerCallbacks>;
  getEpisodeContext?: () => number[] | null;
  setCurrentEpisodeParams?: (params: FA2Params | null) => void;
}

/** @deprecated Compatibility shape for the current page. It is converted to an owned environment. */
export interface LegacyTrainerOptions {
  graph: Graph;
  optimizer: OptimizerFacade;
  controller: LayoutController;
  callbacks: TrainerCallbacks;
  frameBudgetMs: number;
  getIterBudget: () => number;
  getEpisodeContext: () => number[] | null;
  isRunning: () => boolean;
  isAutoTune: () => boolean;
  getCurrentEpisodeParams: () => FA2Params | null;
  setCurrentEpisodeParams: (params: FA2Params | null) => void;
}

export type TrainerOptions = EnvironmentTrainerOptions | LegacyTrainerOptions;

const DEFAULT_PARAMS: FA2Params = {
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

function toTickStat(result: StepResult): LayoutTickStats {
  const raw = result.observation.raw;
  return {
    timestamp: result.observation.step,
    meanDisplacement: raw.meanDisplacement,
    maxDisplacement: raw.maxDisplacement,
    stdDisplacement: 0,
    kineticEnergy: raw.meanDisplacement,
    nodeCount: raw.nodeCount,
    edgeCrossings: raw.edgeCrossings,
    edgeLengthCV: raw.edgeLengthCV,
    nodeSpread: raw.nodeSpread,
    aspectRatio: raw.aspectRatio,
    totalEdgeLength: raw.meanEdgeLength * raw.edgeCount,
  };
}

function environmentForGraph(graph: Graph, iterationHorizon: number): LayoutEnvironment {
  const edges: LayoutScenario["graph"]["edges"] = [];
  graph.forEachEdge((_edge, attrs, source, target) => edges.push({ source, target, weight: Number(attrs.weight) || 1 }));
  return new LayoutEnvironment({
    graph: { nodes: graph.nodes().map((id) => ({ id })), edges },
    seed: 0,
    initialPositionPolicy: { kind: "circle" },
    fa2: DEFAULT_PARAMS,
    iterationsPerStep: 1,
    iterationHorizon: Math.max(1, Math.floor(iterationHorizon)),
  });
}

/**
 * Runs fixed environment steps. A UI may schedule `run(maxSteps, token)`, but a
 * stale callback cannot affect a later run because `start`, `stop`, and `reset`
 * invalidate the monotonic token.
 */
export class LayoutTrainer {
  private readonly environment: LayoutEnvironment;
  private readonly optimizer: CoreOptimizer;
  private readonly callbacks: Partial<TrainerCallbacks>;
  private readonly getEpisodeContext: () => number[] | null;
  private readonly setCurrentEpisodeParams: (params: FA2Params | null) => void;
  private readonly initialParams: FA2Params;
  private active = false;
  private runToken = 0;
  private episode = 0;
  private currentParams: FA2Params | null = null;
  private episodeRewards: number[] = [];
  private lastStat: LayoutTickStats | null = null;

  constructor(opts: TrainerOptions) {
    if ("environment" in opts) {
      this.environment = opts.environment;
      this.optimizer = opts.optimizer;
      this.callbacks = opts.callbacks ?? {};
      this.getEpisodeContext = opts.getEpisodeContext ?? (() => null);
      this.setCurrentEpisodeParams = opts.setCurrentEpisodeParams ?? (() => {});
      this.initialParams = { ...opts.initialParams, scalingRatio: 1, adjustSizes: true };
      return;
    }
    this.environment = environmentForGraph(opts.graph, opts.getIterBudget());
    this.optimizer = opts.optimizer;
    this.callbacks = opts.callbacks;
    this.getEpisodeContext = opts.getEpisodeContext;
    this.setCurrentEpisodeParams = opts.setCurrentEpisodeParams;
    this.initialParams = { ...(opts.getCurrentEpisodeParams() ?? DEFAULT_PARAMS), scalingRatio: 1, adjustSizes: true };
  }

  /** Starts a new run and returns the token a UI scheduler must retain. */
  start(): number {
    this.runToken++;
    this.active = true;
    this.episode = 0;
    this.currentParams = null;
    this.episodeRewards = [];
    this.optimizer.start?.(this.initialParams, new Set());
    return this.runToken;
  }

  /** Executes at most `maxSteps` synchronous environment steps. */
  run(maxSteps = 1, token = this.runToken): TrainerEpisodeResult[] {
    if (!this.active || token !== this.runToken) return [];
    const results: TrainerEpisodeResult[] = [];
    for (let index = 0; index < Math.max(0, Math.floor(maxSteps)); index++) {
      if (!this.active || token !== this.runToken) break;
      if (!this.currentParams) this.startEpisode();
      const step = this.environment.step({ settings: this.currentParams! });
      const stat = toTickStat(step);
      this.optimizer.observe?.(stat);
      this.callbacks.onIteration?.(stat, step.observation.iterations);
      const calibrated = !step.calibrating && (this.optimizer.isCalibrated?.() ?? true);
      const reward = calibrated ? (this.optimizer.reward?.(stat) ?? step.reward) : null;
      if (reward !== null && Number.isFinite(reward)) this.episodeRewards.push(reward);
      const result = { ...step, reward, calibrating: !calibrated, params: this.currentParams!, episode: this.episode };
      results.push(result);
      if (step.terminated || step.truncated) this.finishEpisode(result);
    }
    this.updateStats();
    return results;
  }

  stop(): void {
    this.active = false;
    this.runToken++;
  }

  reset(): void {
    this.stop();
    this.environment.reset();
    this.currentParams = null;
    this.episodeRewards = [];
    this.setCurrentEpisodeParams(null);
  }

  /** Change the explicit iteration horizon and invalidate all queued scheduler work. */
  restart(iterationHorizon: number): number {
    this.stop();
    this.environment.setIterationHorizon(iterationHorizon);
    return this.start();
  }

  getRunToken(): number {
    return this.runToken;
  }

  getLastStat(): LayoutTickStats | null {
    return this.lastStat;
  }

  getLiveEpStartCount(): number {
    return this.episode;
  }

  private startEpisode(): void {
    const context = this.getEpisodeContext();
    this.currentParams = this.optimizer.chooseArm(context, this.currentParams ?? this.initialParams);
    this.currentParams = { ...this.currentParams, scalingRatio: 1, adjustSizes: true };
    this.environment.startEpisode();
    this.episodeRewards = [];
    this.setCurrentEpisodeParams(this.currentParams);
    this.callbacks.onEpisodeStart?.(this.currentParams);
  }

  private finishEpisode(result: TrainerEpisodeResult): void {
    const context = this.getEpisodeContext();
    const reward = this.episodeRewards.length
      ? this.episodeRewards.reduce((sum, value) => sum + value, 0) / this.episodeRewards.length
      : null;
    if (reward !== null && Number.isFinite(reward)) {
      const strictBest = this.optimizer.recordEpisode(reward, context);
      if (strictBest) {
        this.callbacks.onStrictBest?.(strictBest.params, strictBest.reward);
      }
      this.callbacks.onEpisodeComplete?.(result.params, reward, context);
    }
    this.callbacks.onEpisodeResult?.({ ...result, reward });
    this.episode++;
    this.currentParams = null;
    this.episodeRewards = [];
  }

  private updateStats(): void {
    const snapshot = this.optimizer.getSnapshot?.();
    this.callbacks.onStatsUpdate?.({
      totalEpisodes: snapshot?.episode ?? this.episode,
      episodesPerSec: 0,
      lastEpisodeReward: snapshot?.currentReward ?? 0,
      bestReward: snapshot?.bestReward ?? 0,
      trainingTime: 0,
      iterationsPerSec: 0,
    });
  }
}
