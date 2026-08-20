import type { FA2Params, HeuristicWeights, HeuristicFeatures, LayoutTickStats } from "./layout-optimizer";
import type { BanditSnapshot, Sign } from "./rl-bandit";

export type OptimizerFacade = {
  start(initial: FA2Params, locked: Set<keyof FA2Params>): void;
  stop(): void;
  chooseArm(context: number[] | null, currentSettings: FA2Params): FA2Params;
  recordEpisode(reward: number, context: number[] | null): void;
  observe(stat: LayoutTickStats): void;
  reward(stat: LayoutTickStats): number;
  featureView(stat: LayoutTickStats): HeuristicFeatures;
  getSnapshot(): BanditSnapshot;
  setWeights(w: HeuristicWeights): void;
  setSigns(s: Record<keyof HeuristicFeatures, Sign>): void;
  setLockedParams(locked: Set<keyof FA2Params>): void;
  setIncumbentParam(key: keyof FA2Params, value: number | boolean): void;
  setChunksPerEval(n: number): void;
  isCalibrated(): boolean;
};
