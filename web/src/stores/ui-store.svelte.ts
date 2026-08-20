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
  fixedSeed: number;
  onlyWithinCluster: boolean;

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
  nodeCount: 46,
  clusterCount: 2,
  degreeRatio: 0.3,
  fixedSeed: 42,
  onlyWithinCluster: true,
  currentGraph: null,
  graphReady: false,
  autoFit: true,
  showGrid: true,
  showTrails: false,
  trailOpacity: 0.55,
  enforceBounds: true,
  boundsMaxX: 0.4,
  boundsMaxY: 0.3,
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
  uiState.fixedSeed = 42;
  uiState.onlyWithinCluster = false;
  uiState.currentGraph = null;
  uiState.graphReady = false;
  uiState.autoFit = true;
  uiState.showGrid = true;
  uiState.showTrails = false;
  uiState.trailOpacity = 0.55;
  uiState.enforceBounds = true;
  uiState.boundsMaxX = 0.4;
  uiState.boundsMaxY = 0.3;
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

export function setFixedSeed(value: number) {
  uiState.fixedSeed = value;
}

export function setOnlyWithinCluster(value: boolean) {
  uiState.onlyWithinCluster = value;
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