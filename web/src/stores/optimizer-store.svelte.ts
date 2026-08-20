import type { FA2Params, HeuristicWeights, HeuristicFeatures } from "../graph/layout-optimizer";
import type { BanditSnapshot, Sign } from "../graph/rl-bandit";
import { defaultWeights, FEATURE_SIGN } from "../graph/layout-optimizer";

export interface OptimizerState {
  autoTune: boolean;
  episodeLength: number;
  weights: HeuristicWeights;
  signs: Record<keyof HeuristicFeatures, Sign>;
  ignoreWeights: Record<keyof HeuristicFeatures, boolean>;
  lockedParams: Set<keyof FA2Params>;
  currentEpisodeParams: FA2Params | null;
  optimState: BanditSnapshot | null;
  trainerStats: TrainerStats;
  episodeMeans: number[];
  episodeItersPerSec: number[];
}

export interface TrainerStats {
  totalEpisodes: number;
  episodesPerSec: number;
  lastEpisodeReward: number;
  bestReward: number;
  trainingTime: number;
  iterationsPerSec: number;
}

const initialTrainerStats: TrainerStats = {
  totalEpisodes: 0,
  episodesPerSec: 0,
  lastEpisodeReward: 0,
  bestReward: -Infinity,
  trainingTime: 0,
  iterationsPerSec: 0,
};

const initialState: OptimizerState = {
  autoTune: false,
  episodeLength: 3,
  weights: defaultWeights(),
  signs: { ...FEATURE_SIGN },
  ignoreWeights: {
    angle: false,
    minAngle: false,
    cross: false,
    cv: false,
    aspect: false,
    motion: false,
    center: false,
  },
  lockedParams: new Set<keyof FA2Params>(),
  currentEpisodeParams: null,
  optimState: null,
  trainerStats: initialTrainerStats,
  episodeMeans: [],
  episodeItersPerSec: [],
};

export const optimizerState = $state<OptimizerState>({ ...initialState });

export function resetOptimizerState() {
  optimizerState.autoTune = false;
  optimizerState.episodeLength = 3;
  optimizerState.weights = defaultWeights();
  optimizerState.signs = { ...FEATURE_SIGN };
  optimizerState.ignoreWeights = {
    angle: false,
    minAngle: false,
    cross: false,
    cv: false,
    aspect: false,
    motion: false,
    center: false,
  };
  optimizerState.lockedParams = new Set();
  optimizerState.currentEpisodeParams = null;
  optimizerState.optimState = null;
  optimizerState.trainerStats = initialTrainerStats;
  optimizerState.episodeMeans = [];
  optimizerState.episodeItersPerSec = [];
}

export function setAutoTune(value: boolean) {
  optimizerState.autoTune = value;
  if (!value) {
    optimizerState.currentEpisodeParams = null;
    optimizerState.optimState = null;
    optimizerState.trainerStats = initialTrainerStats;
    optimizerState.episodeMeans = [];
    optimizerState.episodeItersPerSec = [];
  }
}

export function setEpisodeLength(value: number) {
  optimizerState.episodeLength = value;
}

export function setWeights(weights: HeuristicWeights) {
  optimizerState.weights = weights;
}

export function setSigns(signs: Record<keyof HeuristicFeatures, Sign>) {
  optimizerState.signs = signs;
}

export function toggleIgnoreWeight(key: keyof HeuristicFeatures) {
  optimizerState.ignoreWeights[key] = !optimizerState.ignoreWeights[key];
}

export function toggleLock(key: keyof FA2Params) {
  const next = new Set(optimizerState.lockedParams);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  optimizerState.lockedParams = next;
}

export function setLockedParams(locked: Set<keyof FA2Params>) {
  optimizerState.lockedParams = locked;
}

export function setCurrentEpisodeParams(params: FA2Params | null) {
  optimizerState.currentEpisodeParams = params;
}

export function setOptimState(state: BanditSnapshot | null) {
  optimizerState.optimState = state;
}

export function updateTrainerStats(stats: Partial<TrainerStats>) {
  optimizerState.trainerStats = { ...optimizerState.trainerStats, ...stats };
}

export function addEpisodeMean(reward: number) {
  optimizerState.episodeMeans = [...optimizerState.episodeMeans, reward].slice(-10);
}

export function addEpisodeItersPerSec(ips: number) {
  optimizerState.episodeItersPerSec = [...optimizerState.episodeItersPerSec, ips].slice(-10);
}