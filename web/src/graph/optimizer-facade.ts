import type { FA2Params, HeuristicWeights, HeuristicFeatures } from "./layout-optimizer";
import type { LayoutTickStats } from "./layout";
import type { BanditSnapshot, Sign, StrictBestEvent } from "./rl-bandit";

export type OptimizerFacade = {
  start(initial: FA2Params, locked: Set<keyof FA2Params>): void;
  reset(initial: FA2Params, locked: Set<keyof FA2Params>): void;
  stop(): void;
  chooseArm(context: number[] | null, currentSettings: FA2Params): FA2Params;
	recordEpisode(reward: number, context: number[] | null): StrictBestEvent | null;
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

export type { OptimizerFacade as default };
