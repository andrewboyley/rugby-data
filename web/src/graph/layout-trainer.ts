import Graph from "graphology";
import type { FA2Params } from "./layout-optimizer";
import type { LayoutTickStats } from "./layout";
import type { OptimizerFacade, LayoutController } from "./index";

export interface TrainerCallbacks {
  onEpisodeComplete: (params: FA2Params, reward: number, context: number[] | null) => void;
  onEpisodeStart: (params: FA2Params) => void;
  onIteration: (stat: LayoutTickStats, iteration: number) => void;
  onStatsUpdate: (stats: TrainerStats) => void;
}

export interface TrainerStats {
  totalEpisodes: number;
  episodesPerSec: number;
  lastEpisodeReward: number;
  bestReward: number;
  trainingTime: number;
  iterationsPerSec: number;
}

export interface TrainerOptions {
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

export class LayoutTrainer {
  private graph: Graph;
  private optimizer: OptimizerFacade;
  private controller: LayoutController;
  private callbacks: TrainerCallbacks;
  private frameBudgetMs: number;
  private getIterBudget: () => number;
  private getEpisodeContext: () => number[] | null;
  private isRunning: () => boolean;
  private isAutoTune: () => boolean;
  private getCurrentEpisodeParams: () => FA2Params | null;
  private setCurrentEpisodeParams: (params: FA2Params | null) => void;

  private trainerInterval: number | null = null;
  private trainStart = 0;
  private trainIterCount = 0;
  private episodeRewards: number[] = [];
  private lastSampleTs = 0;
  private itersAtSample = 0;
  private smoothIps = 0;
  private liveEpStartCount = 0;
  private lastStat: LayoutTickStats | null = null;
  private iterationCount = 0;
  private currentSettings: FA2Params | null = null;

  constructor(opts: TrainerOptions) {
    this.graph = opts.graph;
    this.optimizer = opts.optimizer;
    this.controller = opts.controller;
    this.callbacks = opts.callbacks;
    this.frameBudgetMs = opts.frameBudgetMs;
    this.getIterBudget = opts.getIterBudget;
    this.getEpisodeContext = opts.getEpisodeContext;
    this.isRunning = opts.isRunning;
    this.isAutoTune = opts.isAutoTune;
    this.getCurrentEpisodeParams = opts.getCurrentEpisodeParams;
    this.setCurrentEpisodeParams = opts.setCurrentEpisodeParams;
  }

  start() {
    if (this.trainerInterval !== null) return;
    this.trainStart = performance.now();
    this.lastSampleTs = this.trainStart;
    this.itersAtSample = 0;
    this.smoothIps = 0;
this.episodeRewards = [];
      this.liveEpStartCount = 0;
      this.trainIterCount = 0;
      this.iterationCount = 0;

    const trainLoop = () => {
      if (!this.isAutoTune() || !this.isRunning()) {
        this.trainerInterval = null;
        return;
      }
      if (!this.graph) {
        this.trainerInterval = requestAnimationFrame(trainLoop);
        return;
      }

      const frameStart = performance.now();
      while (performance.now() - frameStart < this.frameBudgetMs) {
        if (this.trainIterCount <= 0) {
          this.finishEpisode();
          this.startNewEpisode();
        }

        const params = this.getCurrentEpisodeParams() ?? this.currentSettings ?? { gravity: 1, slowDown: 1, scalingRatio: 10, strongGravityMode: false, barnesHutOptimize: true, barnesHutTheta: 0.5, edgeWeightInfluence: 1, outboundAttractionDistribution: false, linLogMode: false, adjustSizes: false } as FA2Params;
        this.currentSettings = params;
        const result = this.controller.stepWithParams(params);

        if (result.stat) {
          this.lastStat = result.stat;
          this.optimizer.observe(result.stat);
          let r = this.optimizer.reward(result.stat);
          if (result.badNodes > 0 || !Number.isFinite(r)) r = -10;
          this.episodeRewards.push(r);
          this.callbacks.onIteration(result.stat, this.iterationCount);
        }

        this.trainIterCount -= 1;
      this.iterationCount++;
      }

      this.updateStats();
      this.trainerInterval = requestAnimationFrame(trainLoop);
    };

    this.trainerInterval = requestAnimationFrame(trainLoop);
  }

  stop() {
    if (this.trainerInterval !== null) {
      cancelAnimationFrame(this.trainerInterval);
      this.trainerInterval = null;
    }
  }

  private finishEpisode() {
    if (this.episodeRewards.length === 0) return;

    let weightedSum = 0;
    let weightSum = 0;
    for (let j = 0; j < this.episodeRewards.length; j++) {
      const weight = j + 1;
      weightedSum += this.episodeRewards[j] * weight;
      weightSum += weight;
    }
    const epReward = Number.isFinite(weightedSum) && weightSum > 0 ? weightedSum / weightSum : -10;

    const context = this.getEpisodeContext();
    this.optimizer.recordEpisode(epReward, context);
    this.callbacks.onEpisodeComplete(this.getCurrentEpisodeParams()!, epReward, context);

    const now = performance.now();
    const dtS = (now - this.lastSampleTs) / 1000;
    if (dtS > 0) {
      const ips = (this.iterationCount - this.itersAtSample) / dtS;
      this.smoothIps = this.smoothIps ? this.smoothIps * 0.8 + ips * 0.2 : ips;
      this.lastSampleTs = now;
      this.itersAtSample = this.iterationCount;
    }

    this.episodeRewards = [];
  }

  private startNewEpisode() {
    const context = this.getEpisodeContext();
    const params = this.optimizer.chooseArm(context, this.currentSettings ?? { gravity: 1, slowDown: 1, scalingRatio: 10, strongGravityMode: false, barnesHutOptimize: true, barnesHutTheta: 0.5, edgeWeightInfluence: 1, outboundAttractionDistribution: false, linLogMode: false, adjustSizes: false } as FA2Params);
    this.setCurrentEpisodeParams(params);
    this.trainIterCount = this.getIterBudget();
    this.controller.resetToCircle(100);
    this.callbacks.onEpisodeStart(params);
    this.liveEpStartCount++;
  }

  private updateStats() {
    const elapsed = (performance.now() - this.trainStart) / 1000;
    const snap = this.optimizer.getSnapshot();

    const stats: TrainerStats = {
      totalEpisodes: snap.episode,
      episodesPerSec: elapsed > 0 ? snap.episode / elapsed : 0,
      lastEpisodeReward: snap.currentReward,
      bestReward: snap.bestReward,
      trainingTime: elapsed,
      iterationsPerSec: this.smoothIps,
    };

    this.callbacks.onStatsUpdate(stats);
  }

  getLastStat(): LayoutTickStats | null {
    return this.lastStat;
  }

  getLiveEpStartCount(): number {
    return this.liveEpStartCount;
  }
}