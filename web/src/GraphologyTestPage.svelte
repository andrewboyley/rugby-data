<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import Graph from "graphology";
  import Sigma from "sigma";
  import { sdfCircle } from "sigma/rendering";
  import { fitViewportToNodes } from "@sigma/utils";
  import type { EdgeReducer, NodeReducer } from "sigma/types";
  import ParamControls from "./components/ParamControls.svelte";
  import LiveViewPanel from "./LiveViewPanel.svelte";
  import AutoTunePanel from "./components/AutoTunePanel.svelte";
  import { LayoutEnvironment, LayoutTrainer, FA2OptimizerAdapter, generateGraph, estimateEdges, clampNodeCount, MAX_EDGES, type FA2Params, type FA2ParamKey, type LayoutTickStats } from "./graph";
   import { createGridOverlay, type GridOverlay } from "./graph/grid";
   import { createCameraControls, type CameraControls } from "./graph/camera-controls";
  import { TrainingSessionModel, type TrainingSessionSnapshot } from "./graph/training-session";
  import type { TestBenchApplication, TestBenchState, TestBenchVisuals } from "./test-bench";
  import { layoutState, resetLayoutState, startLayout, stopLayout, recordTick, clearLayoutMetrics } from "./stores/layout-store.svelte";
import { optimizerState, setAutoTune, setEpisodeLength, toggleLock, updateTrainerStats, addEpisodeMean, recordCalibrationStep } from "./stores/optimizer-store.svelte";
   import { uiState, setGraph, setSettingsTab, setBottomTab, toggleBottomOpen, setNodeCount, setClusterCount, setDegreeRatio, setEdgeWeight, setFixedSeed, setOnlyWithinCluster, setGraphGenerationSettings, setAutoFit, setShowGrid, setShowTrails, setTrailOpacity, type GraphGenerationSettings } from "./stores/ui-store.svelte";

  const DEFAULT_FA2_SETTINGS: FA2Params = {
    gravity: 0.1, slowDown: 1, scalingRatio: 1, strongGravityMode: true,
    barnesHutOptimize: true, barnesHutTheta: 0.5, edgeWeightInfluence: 1,
    outboundAttractionDistribution: true, linLogMode: false, adjustSizes: true,
  };
  const SETTINGS_KEY = uiState.storageKey;
  const STEPS_PER_FRAME = 1;
  const CONTINUOUS_LAYOUT_HORIZON = Number.MAX_SAFE_INTEGER;

  let host: HTMLElement | null = null;
  let trailCanvas: HTMLCanvasElement | null = null;
  let sigma: Sigma | null = null;
  type WebGL2State = "unknown" | "available" | "unavailable";
  let webgl2State = $state<WebGL2State>("unknown");
   let grid: GridOverlay | null = null;
   let cameraControls: CameraControls | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let rafId: number | null = null;
  let liveEnvironment = $state<LayoutEnvironment | null>(null);
  let trialEnvironment = $state<LayoutEnvironment | null>(null);
  let trainer: LayoutTrainer | null = null;
  let trainerToken = 0;
  let policyResetGeneration = 0;
  let graphGeneration = 0;
  let settingsLoaded = $state(false);
  let fa2Settings = $state<FA2Params>({ ...DEFAULT_FA2_SETTINGS });
  let manualIterationsPerTick = $state(1);
  let sidebarOpen = $state(true);
  let trailHistory = new Map<string, Array<{ x: number; y: number }>>();
  let trailSegmentCount = 0;
  const optimizer = new FA2OptimizerAdapter();
  let trainingSession = createTrainingSession(DEFAULT_FA2_SETTINGS);
   let trainingSnapshot = $state<TrainingSessionSnapshot>(trainingSession.snapshot());
   let strictBestApplication = $state<TestBenchApplication | null>(null);
   let graphDraft = $state<GraphGenerationSettings>({
     nodeCount: uiState.nodeCount,
     clusterCount: uiState.clusterCount,
     degreeRatio: uiState.degreeRatio,
     edgeWeight: uiState.edgeWeight,
     fixedSeed: uiState.fixedSeed,
     onlyWithinCluster: uiState.onlyWithinCluster,
   });
   let graphCommitTimer: ReturnType<typeof setTimeout> | null = null;

  const estEdgeCount = $derived(estimateEdges({ nodeCount: uiState.nodeCount, clusterCount: uiState.clusterCount, degreeRatio: uiState.degreeRatio, edgeWeight: uiState.edgeWeight, seed: uiState.fixedSeed }));

  function currentSettings(): FA2Params {
    return { ...fa2Settings, scalingRatio: 1, adjustSizes: true };
  }

  function createTrainingSession(initialParams: FA2Params): TrainingSessionModel {
    return new TrainingSessionModel({
      initialParams,
      lockedParams: optimizerState.lockedParams,
      policy: {
        reset: (params, locked) => {
          optimizer.reset(params, locked);
          policyResetGeneration += 1;
        },
      },
    });
  }

  function refreshTrainingSnapshot(): TrainingSessionSnapshot {
    trainingSnapshot = trainingSession.snapshot();
    return trainingSnapshot;
  }

  function livePositions(): Record<string, { x: number; y: number }> {
    const environment = liveEnvironment;
    if (!environment) return {};
    return Object.fromEntries(environment.graph.nodes().map((id) => {
      const attributes = environment.graph.getNodeAttributes(id);
      return [id, { x: Number(attributes.x), y: Number(attributes.y) }];
    }));
  }

  function trainingIsActive(): boolean {
    return trainingSnapshot.execution.state === "active";
  }

  function hasScheduledWork(): boolean {
    return layoutState.running || trainingIsActive();
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function validParams(value: unknown): FA2Params | null {
    if (!isRecord(value)) return null;
    const candidate = { ...DEFAULT_FA2_SETTINGS };
    for (const key of Object.keys(candidate) as FA2ParamKey[]) {
      const next = value[key];
      if (typeof candidate[key] === "boolean") {
        if (typeof next !== "boolean") return null;
      } else if (typeof next !== "number" || !Number.isFinite(next)) {
        return null;
      }
      (candidate as Record<FA2ParamKey, number | boolean>)[key] = next;
    }
    return candidate;
  }

  function loadSettings(): void {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const data: unknown = JSON.parse(raw);
      if (!isRecord(data)) return;
      const params = validParams(data.fa2Settings);
      if (params) fa2Settings = params;
      if (typeof data.manualIterationsPerTick === "number" && Number.isInteger(data.manualIterationsPerTick)) manualIterationsPerTick = Math.max(1, Math.min(3, data.manualIterationsPerTick));
      if (typeof data.nodeCount === "number" && Number.isInteger(data.nodeCount)) setNodeCount(Math.max(1, Math.min(1000, data.nodeCount)));
      if (typeof data.clusterCount === "number" && Number.isInteger(data.clusterCount)) setClusterCount(Math.max(1, Math.min(20, data.clusterCount)));
      if (typeof data.degreeRatio === "number" && Number.isFinite(data.degreeRatio)) setDegreeRatio(Math.max(0.01, Math.min(1, data.degreeRatio)));
      if (typeof data.edgeWeight === "number" && Number.isFinite(data.edgeWeight)) setEdgeWeight(Math.max(0.25, Math.min(5, data.edgeWeight)));
      if (typeof data.fixedSeed === "number" && Number.isInteger(data.fixedSeed)) setFixedSeed(Math.max(0, Math.min(2147483647, data.fixedSeed)));
      if (typeof data.onlyWithinCluster === "boolean") setOnlyWithinCluster(data.onlyWithinCluster);
      if (typeof data.autoFit === "boolean") setAutoFit(data.autoFit);
      if (typeof data.showGrid === "boolean") setShowGrid(data.showGrid);
      if (typeof data.showTrails === "boolean") setShowTrails(data.showTrails);
      if (typeof data.trailOpacity === "number" && Number.isFinite(data.trailOpacity)) setTrailOpacity(Math.max(0, Math.min(1, data.trailOpacity)));
     } catch { /* A malformed old preference must not prevent rendering. */ }
     graphDraft = {
       nodeCount: uiState.nodeCount,
       clusterCount: uiState.clusterCount,
       degreeRatio: uiState.degreeRatio,
       edgeWeight: uiState.edgeWeight,
       fixedSeed: uiState.fixedSeed,
       onlyWithinCluster: uiState.onlyWithinCluster,
     };
   }

   function commitGraphDraft(): void {
     if (graphCommitTimer !== null) {
       clearTimeout(graphCommitTimer);
       graphCommitTimer = null;
     }
     graphDraft.nodeCount = clampNodeCount({ ...graphDraft, seed: graphDraft.fixedSeed }).nodeCount;
     setGraphGenerationSettings({ ...graphDraft });
   }

   function scheduleGraphCommit(): void {
     if (graphCommitTimer !== null) clearTimeout(graphCommitTimer);
     graphCommitTimer = setTimeout(() => {
       graphCommitTimer = null;
       graphDraft.nodeCount = clampNodeCount({ ...graphDraft, seed: graphDraft.fixedSeed }).nodeCount;
       setGraphGenerationSettings({ ...graphDraft });
     }, 150);
   }

  $effect(() => {
    if (!settingsLoaded) return;
    const data = { fa2Settings, manualIterationsPerTick, nodeCount: uiState.nodeCount, clusterCount: uiState.clusterCount, degreeRatio: uiState.degreeRatio, edgeWeight: uiState.edgeWeight, fixedSeed: uiState.fixedSeed, onlyWithinCluster: uiState.onlyWithinCluster, autoFit: uiState.autoFit, showGrid: uiState.showGrid, showTrails: uiState.showTrails, trailOpacity: uiState.trailOpacity };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch { /* Storage can be unavailable. */ }
  });

  $effect(() => {
    const bounded = clampNodeCount({ nodeCount: uiState.nodeCount, clusterCount: uiState.clusterCount, degreeRatio: uiState.degreeRatio, edgeWeight: uiState.edgeWeight, seed: uiState.fixedSeed }).nodeCount;
    if (bounded !== uiState.nodeCount) setNodeCount(bounded);
  });

  $effect(() => {
    uiState.autoFit;
    uiState.showGrid;
    if (uiState.showGrid) grid?.draw();
    if (uiState.autoFit) fitCamera();
  });

  $effect(() => {
    uiState.nodeCount; uiState.clusterCount; uiState.degreeRatio; uiState.edgeWeight; uiState.fixedSeed; uiState.onlyWithinCluster;
    if (!settingsLoaded || !host) return;
    untrack(() => { ensureSigma(); rebuildEnvironment(); });
  });

  onMount(() => {
    loadSettings();
    settingsLoaded = true;
  });

  function decorateEnvironment(source: ReturnType<typeof generateGraph>): void {
    const environment = liveEnvironment;
    if (!environment) return;
    source.graph.forEachNode((id, attrs) => {
      if (!environment.graph.hasNode(id)) return;
      environment.graph.mergeNodeAttributes(id, { color: String(attrs.color), size: Number(attrs.size) });
    });
    const edgeAttributes = new Map<string, { color: string; weight: number }>();
    for (const edge of source.graph.export().edges) {
      const [first, second] = [String(edge.source), String(edge.target)].sort();
      const attrs = edge.attributes ?? {};
      edgeAttributes.set(`${first}\u0000${second}`, { color: String(attrs.color), weight: Number(attrs.weight) });
    }
    environment.graph.forEachEdge((edge, _attrs, sourceId, targetId) => {
      const [first, second] = [String(sourceId), String(targetId)].sort();
      const attrs = edgeAttributes.get(`${first}\u0000${second}`);
      if (attrs) environment.graph.mergeEdgeAttributes(edge, attrs);
    });
  }

  function rebuildEnvironment(): void {
    stopAllScheduling();
    const source = generateGraph({ nodeCount: uiState.nodeCount, clusterCount: uiState.clusterCount, degreeRatio: uiState.degreeRatio, edgeWeight: uiState.edgeWeight, seed: uiState.fixedSeed, onlyWithinCluster: uiState.onlyWithinCluster });
    const nodes = source.graph.nodes().map((id) => {
      const attrs = source.graph.getNodeAttributes(id);
      return { id, color: String(attrs.color), size: Number(attrs.size) };
    });
    const edges = source.graph.export().edges.map((edge) => {
      const attrs = edge.attributes ?? {};
      return { source: String(edge.source), target: String(edge.target), weight: Number(attrs.weight) || 1, color: String(attrs.color) };
    });
    destroySigmaView();
    liveEnvironment?.close();
    trialEnvironment?.close();
    const scenario = { graph: { nodes, edges }, seed: uiState.fixedSeed, initialPositionPolicy: { kind: "circle" as const, centerX: 0, centerY: 0, radius: 100 }, fa2: currentSettings(), iterationsPerStep: 1, iterationHorizon: optimizerState.episodeLength };
    liveEnvironment = new LayoutEnvironment({ ...scenario, iterationsPerStep: optimizerState.autoTune ? 1 : manualIterationsPerTick, iterationHorizon: CONTINUOUS_LAYOUT_HORIZON });
    trialEnvironment = new LayoutEnvironment(scenario);
    graphGeneration += 1;
    trainingSession = createTrainingSession(currentSettings());
    refreshTrainingSnapshot();
    strictBestApplication = null;
    decorateEnvironment(source);
    setGraph(liveEnvironment.graph);
    resetLayoutState();
    trailHistory = new Map();
    clearTrails();
    trainer = new LayoutTrainer({
      environment: trialEnvironment,
      optimizer: {
        start: (initial) => optimizer.start(initial, optimizerState.lockedParams),
        chooseArm: (context, current) => trainingIsActive() ? optimizer.chooseArm(context, current) : currentSettings(),
        recordEpisode: (reward, context) => { if (trainingIsActive()) return optimizer.recordEpisode(reward, context); },
        observe: (stat) => { if (trainingIsActive()) optimizer.observe(stat); },
        reward: (stat) => optimizer.reward(stat),
        isCalibrated: () => !trainingIsActive() || optimizer.isCalibrated(),
        getSnapshot: () => optimizer.getSnapshot(),
      },
      initialParams: currentSettings(),
      callbacks: {
        onEpisodeStart: (params) => { optimizerState.currentEpisodeParams = params; },
        onEpisodeComplete: (_params, reward) => {
          trainingSession.recordTrial(reward);
          refreshTrainingSnapshot();
          addEpisodeMean(reward);
        },
        onStatsUpdate: updateTrainerStats,
        onStrictBest: (params, reward) => applyStrictBestToLive({ params, reward }),
      },
      setCurrentEpisodeParams: (params) => { optimizerState.currentEpisodeParams = params; },
    });
    ensureSigma();
    sigma?.refresh();
    if (uiState.autoFit) requestAnimationFrame(fitCamera);
  }

  function asTick(result: ReturnType<LayoutEnvironment["step"]>): LayoutTickStats {
    const raw = result.observation.raw;
    return { timestamp: result.observation.step, meanDisplacement: raw.meanDisplacement, maxDisplacement: raw.maxDisplacement, stdDisplacement: 0, kineticEnergy: raw.meanDisplacement, nodeCount: raw.nodeCount, edgeCrossings: raw.edgeCrossings, edgeLengthCV: raw.edgeLengthCV, nodeSpread: raw.nodeSpread, aspectRatio: raw.aspectRatio, totalEdgeLength: raw.meanEdgeLength * raw.edgeCount };
  }

  function startLayoutFn(): void {
    if (!trainer || layoutState.running) return;
    liveEnvironment?.setIterationsPerStep(optimizerState.autoTune ? 1 : manualIterationsPerTick);
    startLayout();
    if (trainingSnapshot.autoTune.enabled) startTraining();
    consumeLiveStep();
    ensureSigma();
    sigma?.refresh();
    schedule(trainerToken);
  }

  function consumeLiveStep(): void {
    if (!liveEnvironment) return;
    const result = liveEnvironment.step({ settings: currentSettings() });
    recordTick(asTick(result), new Map(Object.entries(result.observation.positions)));
    captureTrails(result.observation.positions);
  }

  function consumeTrainerResults(results: ReturnType<LayoutTrainer["run"]>): void {
    for (const result of results) {
      if (result.calibrating || optimizer.isCalibrated()) recordCalibrationStep();
    }
    optimizerState.optimState = optimizer.getSnapshot();
  }

  function cancelScheduledFrame(): void {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function stopAllScheduling(): void {
    cancelScheduledFrame();
    trainer?.stop();
    trainingSession.pauseTraining();
    refreshTrainingSnapshot();
    if (layoutState.running) stopLayout();
  }

  function stopLayoutFn(): void {
    if (layoutState.running) stopLayout();
    if (!trainingIsActive()) cancelScheduledFrame();
  }

  function startTraining(): void {
    if (!trainer) return;
    if (trainingSnapshot.execution.state === "paused") {
      trainingSession.resumeTraining();
    } else {
      trainingSession.startTraining();
      trainerToken = trainer.restart(optimizerState.episodeLength);
    }
    refreshTrainingSnapshot();
    if (trainingIsActive()) consumeTrainerResults(trainer.run(STEPS_PER_FRAME, trainerToken));
  }

  function toggleTrainingPause(): void {
    if (trainingSnapshot.execution.state === "active") {
      trainingSession.pauseTraining();
      refreshTrainingSnapshot();
      if (!layoutState.running) cancelScheduledFrame();
      return;
    }
    if (trainingSnapshot.execution.state === "paused") {
      trainingSession.resumeTraining();
      refreshTrainingSnapshot();
      schedule(trainerToken);
    }
  }

  function schedule(token: number): void {
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!hasScheduledWork()) return;
      if (layoutState.running && liveEnvironment) consumeLiveStep();
      if (trainingIsActive() && trainer && token === trainerToken) consumeTrainerResults(trainer.run(STEPS_PER_FRAME, token));
      sigma?.refresh();
      if (layoutState.running && uiState.autoFit) fitCamera();
      if (layoutState.running && uiState.showTrails) drawTrails();
      if (hasScheduledWork() && token === trainerToken) schedule(token);
    });
  }

  function resetAll(): void {
    stopAllScheduling();
    destroySigmaView();
    trainingSession.confirmReset();
    refreshTrainingSnapshot();
    strictBestApplication = null;
    setAutoTune(false);
    trainer?.reset();
    liveEnvironment?.reset();
    if (liveEnvironment) {
      const source = generateGraph({ nodeCount: uiState.nodeCount, clusterCount: uiState.clusterCount, degreeRatio: uiState.degreeRatio, edgeWeight: uiState.edgeWeight, seed: uiState.fixedSeed, onlyWithinCluster: uiState.onlyWithinCluster });
      decorateEnvironment(source);
    }
    resetLayoutState();
    trailHistory = new Map();
    clearTrails();
    ensureSigma();
    sigma?.refresh();
    grid?.draw();
    if (uiState.autoFit) requestAnimationFrame(fitCamera);
  }

  function handleAutoTuneToggle(): void {
    const enableAutoTune = !optimizerState.autoTune;
    setAutoTune(enableAutoTune);
    if (enableAutoTune) trainingSession.enableAutoTune();
    else {
      trainingSession.disableAutoTune();
      trainer?.stop();
    }
    refreshTrainingSnapshot();
    liveEnvironment?.setIterationsPerStep(optimizerState.autoTune ? 1 : manualIterationsPerTick);
    if (layoutState.running) {
      if (enableAutoTune) startTraining();
      else if (!trainingIsActive()) cancelScheduledFrame();
    }
  }

  function handleManualIterationsChange(): void {
    if (optimizerState.autoTune) return;
    liveEnvironment?.setIterationsPerStep(manualIterationsPerTick);
    if (layoutState.running) {
      cancelScheduledFrame();
      schedule(trainerToken);
    }
  }

  function handleEpisodeLengthChange(): void {
    setEpisodeLength(optimizerState.episodeLength);
    if (!trainingIsActive() || !trainer) return;
    trainerToken = trainer.restart(optimizerState.episodeLength);
    consumeTrainerResults(trainer.run(STEPS_PER_FRAME, trainerToken));
    schedule(trainerToken);
  }

  function handlePolicyReset(): void {
    resetAll();
  }

  function updateParameters(key: FA2ParamKey, value: number | boolean): void {
    fa2Settings = { ...fa2Settings, [key]: value };
    if (layoutState.running) {
      cancelScheduledFrame();
      schedule(trainerToken);
    }
  }

  function applyStrictBestToLive(event: { readonly params: FA2Params; readonly reward: number }): void {
    const environment = liveEnvironment;
    const previousSettings = currentSettings();
    const record = trainingSession.recordStrictBestApplication(event, new Date().toISOString(), previousSettings);
    refreshTrainingSnapshot();
    if (!environment || record === null) return;
    fa2Settings = { ...record.params, scalingRatio: 1, adjustSizes: true };
    environment.resetPositions();
    clearLayoutMetrics();
    trailHistory = new Map();
    clearTrails();
    strictBestApplication = {
      record,
      liveSettings: currentSettings(),
      resetPositions: livePositions(),
      resetMetricCount: layoutState.tickStats.length,
      resetTrailSegments: trailSegmentCount,
    };
    setGraph(environment.graph);
    sigma?.refresh();
    grid?.draw();
  }

  function ensureSigma(): void {
    if (sigma || webgl2State === "unavailable" || !host) return;
    const capabilityProbe = document.createElement("canvas");
    if (!capabilityProbe.getContext("webgl2")) {
      webgl2State = "unavailable";
      return;
    }
    webgl2State = "available";
    let hovered: string | null = null;
    const nodeReducer: NodeReducer = (node, data) => {
      const next = { ...data };
      const graph = liveEnvironment?.graph;
      if (hovered && graph && node !== hovered && !graph.hasEdge(node, hovered)) { next.color = rgba(String(next.color), 0.12); next.label = ""; }
      return next;
    };
    const edgeReducer: EdgeReducer = (edge, data) => {
      const next = { ...data, color: rgba(String(data.color), 0.9) };
      const graph = liveEnvironment?.graph;
      if (hovered && graph) {
        const [source, target] = graph.extremities(edge);
        if (source !== hovered && target !== hovered) next.color = rgba(String(data.color), 0.08);
      }
      return next;
    };
    sigma = new Sigma(liveEnvironment?.graph ?? new Graph({ multi: false }), host, { primitives: { nodes: { shapes: [sdfCircle()] } }, nodeReducer, edgeReducer, styles: { nodes: { size: { attribute: "size" }, color: { attribute: "color" } }, edges: { size: { attribute: "weight" }, color: { attribute: "color" } } }, settings: { allowInvalidContainer: true, itemSizesReference: "positions", autoRescale: false } });
    if (import.meta.env.DEV) {
      window.__rugbyTestBench = { state: testBenchState, visuals: testBenchVisuals };
    }
    grid = createGridOverlay(host, { getSigma: () => sigma, getShow: () => uiState.showGrid });
    resizeObserver = new ResizeObserver(() => { sigma?.refresh(); grid?.draw(); resizeTrailCanvas(); });
    resizeObserver.observe(host);
    sigma.getCamera().addListener("updated", () => {
      grid?.draw();
      host?.dataset && (host.dataset.cameraState = JSON.stringify(sigma?.getCamera().getState() ?? {}));
      if (uiState.showTrails) drawTrails();
    });
    host.dataset.cameraState = JSON.stringify(sigma.getCamera().getState());
    cameraControls = createCameraControls(sigma, () => setAutoFit(false));
    sigma.on("enterNode", ({ node }: { node: string }) => { hovered = node; sigma?.refresh(); });
    sigma.on("leaveNode", () => { hovered = null; sigma?.refresh(); });
  }

  function destroySigmaView(): void {
    cameraControls?.destroy();
    cameraControls = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    grid?.destroy();
    grid = null;
    sigma?.kill();
    sigma = null;
    delete window.__rugbyTestBench;
  }

  function testBenchState(): TestBenchState {
    const live = liveEnvironment;
    const trial = trialEnvironment;
    return {
      live: {
        settings: currentSettings(),
        ticks: layoutState.iterations,
        positions: livePositions(),
        trailSegments: trailSegmentCount,
      },
      training: {
        session: trainingSession.snapshot(),
        calibrationSteps: optimizerState.calibrationSteps,
        scoredTrials: optimizerState.optimState?.leaderboard.length ?? 0,
      },
      locks: [...optimizerState.lockedParams].sort(),
      policyResetGeneration,
      strictBestApplication,
      graph: {
        liveIdentity: live ? `live-${graphGeneration}` : null,
        trialIdentity: trial ? `trial-${graphGeneration}` : null,
        environmentsDistinct: live !== null && trial !== null && live.graph !== trial.graph,
      },
    };
  }

  function testBenchVisuals(): TestBenchVisuals {
    const environment = liveEnvironment;
    if (!environment) return { nodes: [], edges: [], trailSegments: trailSegmentCount };
    return {
      nodes: environment.graph.nodes().map((id) => ({
        attributes: { ...environment.graph.getNodeAttributes(id) },
        display: sigma?.getNodeDisplayData(id) ?? null,
      })),
      edges: environment.graph.edges().map((id) => ({
        attributes: { ...environment.graph.getEdgeAttributes(id) },
        display: sigma?.getEdgeDisplayData(id) ?? null,
      })),
      trailSegments: trailSegmentCount,
    };
  }

  function fitCamera(): void { if (sigma && liveEnvironment) void fitViewportToNodes(sigma, liveEnvironment.graph.nodes(), { animate: false }); }
  function rgba(color: string, alpha: number): string { const hex = color.replace("#", ""); const value = /^([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex); return value ? `rgba(${parseInt(value[1], 16)},${parseInt(value[2], 16)},${parseInt(value[3], 16)},${alpha})` : color; }
  function resizeTrailCanvas(): void { const canvas = trailCanvas; if (!canvas || !host) return; const dpr = devicePixelRatio || 1; canvas.width = Math.round(host.clientWidth * dpr); canvas.height = Math.round(host.clientHeight * dpr); canvas.style.width = `${host.clientWidth}px`; canvas.style.height = `${host.clientHeight}px`; }
  function clearTrails(): void { trailSegmentCount = 0; trailCanvas?.getContext("2d")?.clearRect(0, 0, trailCanvas.width, trailCanvas.height); }
  function captureTrails(positions: Record<string, { x: number; y: number }>): void { for (const [id, position] of Object.entries(positions)) { const points = trailHistory.get(id) ?? []; points.push(position); trailHistory.set(id, points.slice(-20)); } }
  function drawTrails(): void { if (!trailCanvas || !sigma || !liveEnvironment) return; resizeTrailCanvas(); const context = trailCanvas.getContext("2d"); if (!context) return; const dpr = devicePixelRatio || 1; context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, trailCanvas.width / dpr, trailCanvas.height / dpr); context.lineWidth = 3; let segments = 0; liveEnvironment.graph.forEachNode((id) => { const points = trailHistory.get(id) ?? []; for (let index = 1; index < points.length; index++) { const a = sigma!.graphToViewport(points[index - 1]); const b = sigma!.graphToViewport(points[index]); context.strokeStyle = `rgba(245, 159, 0, ${Math.max(0.5, uiState.trailOpacity * index / points.length)})`; context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke(); segments++; } }); trailSegmentCount = segments; }
    onDestroy(() => { if (graphCommitTimer !== null) clearTimeout(graphCommitTimer); stopAllScheduling(); destroySigmaView(); clearTrails(); trailCanvas?.remove(); liveEnvironment?.close(); trialEnvironment?.close(); setGraph(null); });
</script>

<div class="flex h-screen min-w-[480px] flex-col overflow-auto bg-base-100" data-testid="test-page">
  <header class="flex items-center gap-2 border-b border-base-300 p-2"><button class="btn btn-xs btn-ghost" title="Back to main" onclick={() => window.location.href = "/"}>Back</button><span class="font-mono text-sm">ForceAtlas2 test bench</span></header>
  <div class="flex min-h-[420px] flex-1">
    <aside class="w-72 shrink-0 border-r border-base-300 bg-base-200 {sidebarOpen ? '' : 'hidden'}">
       <div class="tabs tabs-lift tabs-sm p-1"><button class="tab {uiState.settingsTab === 'fa2' ? 'tab-active' : ''}" onclick={() => setSettingsTab('fa2')}>ForceAtlas2</button><button class="tab {uiState.settingsTab === 'graph' ? 'tab-active' : ''}" onclick={() => setSettingsTab('graph')}>Graph</button><button aria-label="Hide settings sidebar" class="btn btn-xs btn-ghost ml-auto" onclick={() => sidebarOpen = false}>‹</button></div>
      <div class="p-3">
        {#if uiState.settingsTab === 'fa2'}
            <ParamControls params={currentSettings()} locked={optimizerState.lockedParams} autoTune={optimizerState.autoTune} onChange={updateParameters} onLockToggle={(key) => { toggleLock(key); optimizer.setLockedParams(optimizerState.lockedParams); trainingSession = createTrainingSession(currentSettings()); if (optimizerState.autoTune) trainingSession.enableAutoTune(); refreshTrainingSnapshot(); if (layoutState.running) { cancelScheduledFrame(); startTraining(); schedule(trainerToken); } }} onReset={() => { fa2Settings = { ...DEFAULT_FA2_SETTINGS }; if (layoutState.running) { cancelScheduledFrame(); schedule(trainerToken); } }} />
  {#if !optimizerState.autoTune}<label class="label text-xs">Iterations per tick <input data-testid="manual-iterations-per-tick" class="range range-xs" type="range" min="1" max="3" step="1" bind:value={manualIterationsPerTick} onchange={handleManualIterationsChange}/><span>{manualIterationsPerTick}</span></label>{/if}
            <div class="mt-2 flex gap-2"><button data-testid="start-stop" class="btn btn-sm flex-1" onclick={() => layoutState.running ? stopLayoutFn() : startLayoutFn()}>{layoutState.running ? 'Stop Layout' : 'Start Layout'}</button><button data-testid="reset" class="btn btn-sm btn-ghost" onclick={resetAll}>Reset</button></div>
        {:else}
          <label class="label text-xs">Nodes <input data-testid="node-count" class="range range-xs" type="range" min="1" max="1000" value={graphDraft.nodeCount} oninput={(event) => { graphDraft.nodeCount = Number(event.currentTarget.value); scheduleGraphCommit(); }} onchange={commitGraphDraft}/><span>{graphDraft.nodeCount}</span></label>
          <label class="label text-xs">Clusters <input class="range range-xs" type="range" min="1" max="20" value={graphDraft.clusterCount} oninput={(event) => { graphDraft.clusterCount = Number(event.currentTarget.value); scheduleGraphCommit(); }} onchange={commitGraphDraft}/><span>{graphDraft.clusterCount}</span></label>
          <label class="label text-xs">Degree ratio <input class="range range-xs" type="range" min="0.01" max="1" step="0.01" value={graphDraft.degreeRatio} oninput={(event) => { graphDraft.degreeRatio = Number(event.currentTarget.value); scheduleGraphCommit(); }} onchange={commitGraphDraft}/><span>{graphDraft.degreeRatio.toFixed(2)}</span></label>
          <label class="label text-xs">Seed <input data-testid="seed" class="input input-xs input-bordered" type="number" value={graphDraft.fixedSeed} oninput={(event) => { graphDraft.fixedSeed = Number(event.currentTarget.value); commitGraphDraft(); }}/></label>
          <label class="label cursor-pointer text-xs"><input class="checkbox checkbox-xs" type="checkbox" checked={graphDraft.onlyWithinCluster} onchange={(event) => { graphDraft.onlyWithinCluster = event.currentTarget.checked; commitGraphDraft(); }}/>Only within cluster</label>
            <p data-testid="graph-count" class="font-mono text-xs">Generated graph: {liveEnvironment?.graph.order ?? 0} nodes, {liveEnvironment?.graph.size ?? 0} edges. Est. {estEdgeCount} / {MAX_EDGES}</p>
        {/if}
      </div>
    </aside>
    <main class="relative min-h-[420px] flex-1"><div class="absolute inset-0" data-testid="test-graph" bind:this={host}></div>{#if webgl2State === "unavailable"}<div role="alert" class="absolute inset-0 z-20 flex items-center justify-center bg-base-200 p-6 text-center"><p class="max-w-md text-sm">WebGL2 is unavailable, so this browser cannot render the graph. Enable hardware acceleration or use a WebGL2-capable browser, then reload the page.</p></div>{/if}<canvas class="pointer-events-none absolute inset-0 z-10" bind:this={trailCanvas}></canvas><div class="absolute bottom-3 right-3 z-20 flex flex-col gap-1 rounded bg-base-200/80 p-2 text-xs"><label><input type="checkbox" checked={uiState.autoFit} onchange={(event) => { setAutoFit(event.currentTarget.checked); if (event.currentTarget.checked) fitCamera(); }}/> Auto-fit</label><label><input type="checkbox" checked={uiState.showGrid} onchange={(event) => setShowGrid(event.currentTarget.checked)}/> Grid</label><label><input data-testid="trails" type="checkbox" checked={uiState.showTrails} onchange={(event) => { setShowTrails(event.currentTarget.checked); if (!event.currentTarget.checked) clearTrails(); else requestAnimationFrame(drawTrails); }}/> Trails</label>{#if uiState.showTrails}<input aria-label="Trail opacity" type="range" min="0" max="1" step="0.05" value={uiState.trailOpacity} oninput={(event) => setTrailOpacity(+event.currentTarget.value)}/>{/if}</div></main>
  </div>
      <section class="border-t border-base-300 bg-base-200"><div class="tabs tabs-lift tabs-sm p-1"><button class="tab {uiState.bottomTab === 'live' ? 'tab-active' : ''}" onclick={() => setBottomTab('live')}>Live View</button><button data-testid="autotune-tab" class="tab {uiState.bottomTab === 'autotune' ? 'tab-active' : ''}" onclick={() => { setBottomTab('autotune'); if (!uiState.bottomOpen) toggleBottomOpen(); }}>Auto-tune</button><button aria-label={uiState.bottomOpen ? 'Hide bottom panel' : 'Show bottom panel'} class="btn btn-xs btn-ghost ml-auto" onclick={toggleBottomOpen}>{uiState.bottomOpen ? '▼' : '▲'}</button></div>{#if uiState.bottomOpen}<div class="max-h-80 overflow-y-auto p-3">{#if uiState.bottomTab === 'live'}<LiveViewPanel stats={layoutState.tickStats} running={layoutState.running}/>{:else}<AutoTunePanel running={trainingIsActive()} snapshot={trainingSnapshot} bandit={optimizerState.optimState} onToggle={handleAutoTuneToggle} onTrainingPause={toggleTrainingPause} onHorizonChange={handleEpisodeLengthChange} onResetPolicy={handlePolicyReset}/>{/if}</div>{/if}</section>
</div>
