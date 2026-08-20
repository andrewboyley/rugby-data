import type { LayoutTickStats } from "../graph/layout";

export interface LayoutState {
  running: boolean;
  iterations: number;
  tickStats: LayoutTickStats[];
  lastStat: LayoutTickStats | null;
  previousPositions: Map<string, { x: number; y: number }>;
  heuristicFeat: ReturnType<import("../graph/layout-optimizer").FeatureNormalizer["normalize"]> | null;
  lastFrameTs: number;
}

const initialState: LayoutState = {
  running: false,
  iterations: 0,
  tickStats: [],
  lastStat: null,
  previousPositions: new Map(),
  heuristicFeat: null,
  lastFrameTs: performance.now(),
};

export const layoutState = $state<LayoutState>({ ...initialState });

export function resetLayoutState() {
  layoutState.running = false;
  layoutState.iterations = 0;
  layoutState.tickStats = [];
  layoutState.lastStat = null;
  layoutState.previousPositions = new Map();
  layoutState.heuristicFeat = null;
}

export function startLayout() {
  layoutState.running = true;
  layoutState.iterations = 0;
  layoutState.tickStats = [];
  layoutState.previousPositions = new Map();
  layoutState.lastFrameTs = performance.now();
}

export function stopLayout() {
  layoutState.running = false;
}

export function recordTick(stat: LayoutTickStats, positions: Map<string, { x: number; y: number }>) {
  layoutState.tickStats = [...layoutState.tickStats.slice(-600), stat];
  layoutState.lastStat = stat;
  layoutState.iterations += 1;
  layoutState.previousPositions = positions;
}

export function setHeuristicFeatures(feat: LayoutState["heuristicFeat"]) {
  layoutState.heuristicFeat = feat;
}

export function setPreviousPositions(positions: Map<string, { x: number; y: number }>) {
  layoutState.previousPositions = positions;
}