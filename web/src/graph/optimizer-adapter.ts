import { DiscreteBanditOptimizer } from "./rl-bandit";
import type { FA2Params, HeuristicWeights, HeuristicFeatures } from "./layout-optimizer";
import type { LayoutTickStats } from "./layout";
import type { BanditSnapshot, Sign } from "./rl-bandit";
import type { OptimizerFacade } from "./optimizer-facade";

export class FA2OptimizerAdapter implements OptimizerFacade {
  private bandit: DiscreteBanditOptimizer;

  constructor() {
    this.bandit = new DiscreteBanditOptimizer();
  }

  start(initial: FA2Params, locked: Set<keyof FA2Params>): void {
    this.bandit.start(initial, locked, 4);
  }

  stop(): void {
    this.bandit.stop();
  }

  chooseArm(context: number[] | null, currentSettings: FA2Params): FA2Params {
    return this.bandit.chooseArm(context, currentSettings);
  }

  recordEpisode(reward: number, context: number[] | null): void {
    this.bandit.recordEpisode(reward, context);
  }

  observe(stat: LayoutTickStats): void {
    this.bandit.observe(stat);
  }

  reward(stat: LayoutTickStats): number {
    return this.bandit.reward(stat);
  }

  featureView(stat: LayoutTickStats): HeuristicFeatures {
    return this.bandit.featureView(stat);
  }

  getSnapshot(): BanditSnapshot {
    return this.bandit.snapshot();
  }

  setWeights(w: HeuristicWeights): void {
    this.bandit.setWeights(w);
  }

  setSigns(s: Record<keyof HeuristicFeatures, Sign>): void {
    this.bandit.setSigns(s);
  }

  setLockedParams(locked: Set<keyof FA2Params>): void {
    this.bandit.setLockedParams(locked);
  }

  setIncumbentParam(key: keyof FA2Params, value: number | boolean): void {
    this.bandit.setIncumbentParam(key, value);
  }

  setChunksPerEval(_n: number): void {
    // DiscreteBanditOptimizer doesn't have this method
  }

  isCalibrated(): boolean {
    return this.bandit.isCalibrated();
  }
}