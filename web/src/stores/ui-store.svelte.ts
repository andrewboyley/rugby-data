import Graph from "graphology";

export interface UIState {
  // Tabs
  settingsTab: "fa2" | "graph";
  bottomTab: "live" | "autotune";
  bottomOpen: boolean;

  // Graph generation
  nodeCount: number;
  clusterCount: number;
  degreeRatio: number;
  useFixedSeed: boolean;
  fixedSeed: number;

  // Graph ref
  currentGraph: Graph | null;
  graphReady: boolean;

  // View options
  autoFit: boolean;
  showGrid: boolean;
  showTrails: boolean;
  trailOpacity: number;
  enforceBounds: boolean;
  boundsMaxX: number;
  boundsMaxY: number;

  // Persistence
  storageKey: string;
}

const initialState: UIState = {
  settingsTab: "fa2",
  bottomTab: "live",
  bottomOpen: true,
  nodeCount: 200,
  clusterCount: 10,
  degreeRatio: 0.15,
  useFixedSeed: true,
  fixedSeed: 42,
  currentGraph: null,
  graphReady: false,
  autoFit: true,
  showGrid: true,
  showTrails: false,
  trailOpacity: 0.55,
  enforceBounds: true,
  boundsMaxX: 400,
  boundsMaxY: 300,
  storageKey: "rugby-fa2-settings",
};

export const uiState = $state<UIState>({ ...initialState });

export function resetUIState() {
  uiState.settingsTab = "fa2";
  uiState.bottomTab = "live";
  uiState.bottomOpen = true;
  uiState.nodeCount = 200;
  uiState.clusterCount = 10;
  uiState.degreeRatio = 0.15;
  uiState.useFixedSeed = true;
  uiState.fixedSeed = 42;
  uiState.currentGraph = null;
  uiState.graphReady = false;
  uiState.autoFit = true;
  uiState.showGrid = true;
  uiState.showTrails = false;
  uiState.trailOpacity = 0.55;
  uiState.enforceBounds = true;
  uiState.boundsMaxX = 400;
  uiState.boundsMaxY = 300;
}

export function setGraph(graph: Graph | null) {
  uiState.currentGraph = graph;
  uiState.graphReady = graph !== null;
}

export function setSettingsTab(tab: "fa2" | "graph") {
  uiState.settingsTab = tab;
}

export function setBottomTab(tab: "live" | "autotune") {
  uiState.bottomTab = tab;
}

export function toggleBottomOpen() {
  uiState.bottomOpen = !uiState.bottomOpen;
}

export function setNodeCount(value: number) {
  uiState.nodeCount = value;
}

export function setClusterCount(value: number) {
  uiState.clusterCount = value;
}

export function setDegreeRatio(value: number) {
  uiState.degreeRatio = value;
}

export function setUseFixedSeed(value: boolean) {
  uiState.useFixedSeed = value;
}

export function setFixedSeed(value: number) {
  uiState.fixedSeed = value;
}

export function setAutoFit(value: boolean) {
  uiState.autoFit = value;
}

export function setShowGrid(value: boolean) {
  uiState.showGrid = value;
}

export function setShowTrails(value: boolean) {
  uiState.showTrails = value;
}

export function setTrailOpacity(value: number) {
  uiState.trailOpacity = value;
}

export function setEnforceBounds(value: boolean) {
  uiState.enforceBounds = value;
}

export function setBoundsMaxX(value: number) {
  uiState.boundsMaxX = value;
}

export function setBoundsMaxY(value: number) {
  uiState.boundsMaxY = value;
}