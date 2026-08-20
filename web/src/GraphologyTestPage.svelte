<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import Graph from "graphology";
  import forceAtlas2 from "graphology-layout-forceatlas2";
  import Sigma from "sigma";
  import { sdfCircle } from "sigma/rendering";
  import type { NodeReducer, EdgeReducer } from "sigma/types";
import { fitViewportToNodes } from "@sigma/utils";
import LiveViewPanel from "./LiveViewPanel.svelte";
import ScorePlot, { type PlotSeries } from "./ScorePlot.svelte";
import DebugOverlay from "./DebugOverlay.svelte";
import ParamControls from "./components/ParamControls.svelte";
import FeatureTooltip from "./components/FeatureTooltip.svelte";
  import type { FA2Params, HeuristicWeights } from "./graph/layout-optimizer";
import { LayoutController } from "./graph";
import { LayoutTrainer } from "./graph";
import { FA2OptimizerAdapter } from "./graph";
import { generateGraph, estimateEdges, clampNodeCount, MAX_EDGES, savePositions, assignUnitCircle } from "./graph";
import { layoutState, startLayout as startLayoutStore, stopLayout as stopLayoutStore, resetLayoutState, recordTick, setHeuristicFeatures, setPreviousPositions } from "./stores/layout-store.svelte";
import { optimizerState, setAutoTune, setEpisodeLength, setWeights, setSigns, toggleIgnoreWeight, toggleLock, setLockedParams, updateTrainerStats, addEpisodeMean } from "./stores/optimizer-store.svelte";
  import { uiState, setGraph, setSettingsTab, setBottomTab, toggleBottomOpen, setNodeCount, setClusterCount, setDegreeRatio, setEdgeWeight, setFixedSeed, setOnlyWithinCluster, setAutoFit, setShowGrid, setShowTrails, setTrailOpacity } from "./stores/ui-store.svelte";
import { createGridOverlay, type GridOverlay } from "./graph/grid.ts";

  const CONTEXT_DIM = 4;
  const FRAME_BUDGET_MS = 8;

  function goHome() { window.location.href = "/"; }

  let host: HTMLElement | null = null;
  let sigmaInstance: Sigma | null = null;
  let grid: GridOverlay | null = null;
  let containerObserver: ResizeObserver | null = null;
  let previewGraph: Graph | null = null;
  let isFirstAttach = true;
  let rafId: number | null = null;
  let trailCanvas: HTMLCanvasElement | null = null;
  let showTrails = false;
  let trailOpacity = 0.55;
  let trailHistory = new Map<string, { x: number; y: number }[]>();
  let focusSet = new Set<string>();
  let sidebarOpen = $state(true);
  let debugOverlayVisible = false;

  let layoutController: LayoutController | null = null;
  let trainer: LayoutTrainer | null = null;
  let optimizer = new FA2OptimizerAdapter(true);
  const DEFAULT_FA2_SETTINGS: FA2Params = {
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
  let fa2Settings = $state<FA2Params>({ ...DEFAULT_FA2_SETTINGS });

  function handleAutoTuneToggle() {
    const next = !optimizerState.autoTune;
    setAutoTune(next);
    if (next && layoutState.running) {
      optimizer.start({ ...getCurrentFA2Settings() }, optimizerState.lockedParams);
      optimizerState.optimState = optimizer.getSnapshot();
      trainer?.start();
    } else if (!next) {
      trainer?.stop();
    }
  }

  function handleLockToggle(key: keyof FA2Params) {
    toggleLock(key);
    if (optimizerState.autoTune && optimizer.isCalibrated()) {
      optimizer.retarget({ ...getCurrentFA2Settings() }, optimizerState.lockedParams, CONTEXT_DIM);
    }
  }

  // Derived values for graph generation
  const estEdgeCount = $derived.by(() => estimateEdges({
    nodeCount: uiState.nodeCount,
    clusterCount: uiState.clusterCount,
    degreeRatio: uiState.degreeRatio,
    edgeWeight: uiState.edgeWeight,
    seed: uiState.fixedSeed,
  }));

  // Clamp node count when params change
  $effect(() => {
    const clamped = clampNodeCount({
      nodeCount: uiState.nodeCount,
      clusterCount: uiState.clusterCount,
      degreeRatio: uiState.degreeRatio,
      edgeWeight: uiState.edgeWeight,
      seed: uiState.fixedSeed,
    });
    const bounded = Math.max(1, Math.min(1000, clamped.nodeCount));
    if (bounded !== uiState.nodeCount) {
      setNodeCount(bounded);
    }
  });

  // Update optimizer weights when they change during auto-tune
  $effect(() => {
    if (optimizerState.autoTune) {
      optimizer.setWeights(effectiveWeights());
      optimizer.setSigns({ ...optimizerState.signs });
    }
  });

  $effect(() => {
    const autoFit = uiState.autoFit;
    const showGrid = uiState.showGrid;
    if (showGrid) grid?.draw();
    if (autoFit) fitCamera(true);
  });

  // Persist UI settings
  $effect(() => {
    try {
      const data = {
        fa2Settings: {
          gravity: optimizerState.optimState?.bestParams?.gravity ?? 1,
          slowDown: optimizerState.optimState?.bestParams?.slowDown ?? 1,
          scalingRatio: optimizerState.optimState?.bestParams?.scalingRatio ?? 10,
          strongGravityMode: optimizerState.optimState?.bestParams?.strongGravityMode ?? false,
          barnesHutOptimize: optimizerState.optimState?.bestParams?.barnesHutOptimize ?? true,
          barnesHutTheta: optimizerState.optimState?.bestParams?.barnesHutTheta ?? 0.5,
          edgeWeightInfluence: optimizerState.optimState?.bestParams?.edgeWeightInfluence ?? 1,
          outboundAttractionDistribution: optimizerState.optimState?.bestParams?.outboundAttractionDistribution ?? false,
          linLogMode: optimizerState.optimState?.bestParams?.linLogMode ?? false,
          adjustSizes: optimizerState.optimState?.bestParams?.adjustSizes ?? false,
        },
        lockedParams: Array.from(optimizerState.lockedParams),
        episodeLength: optimizerState.episodeLength,
        heuristicWeights: optimizerState.weights,
        weightSigns: optimizerState.signs,
        ignoreWeights: optimizerState.ignoreWeights,
        nodeCount: uiState.nodeCount,
        clusterCount: uiState.clusterCount,
        degreeRatio: uiState.degreeRatio,
        edgeWeight: uiState.edgeWeight,
        fixedSeed: uiState.fixedSeed,
        onlyWithinCluster: uiState.onlyWithinCluster,
        autoFit: uiState.autoFit,
        showGrid: uiState.showGrid,
        showTrails: uiState.showTrails,
        trailOpacity: uiState.trailOpacity,
      };
      localStorage.setItem(uiState.storageKey, JSON.stringify(data));
    } catch { /* ignore */ }
  });

  // Load settings on mount
  onMount(() => {
    try {
      const raw = localStorage.getItem(uiState.storageKey);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.fa2Settings) {
          // Settings are applied via optimizer state
        }
        if (data.lockedParams) setLockedParams(new Set(data.lockedParams));
        if (data.episodeLength) setEpisodeLength(data.episodeLength);
        if (data.heuristicWeights) setWeights(data.heuristicWeights);
        if (data.weightSigns) setSigns(data.weightSigns);
        if (data.ignoreWeights) {
          for (const [k, v] of Object.entries(data.ignoreWeights)) {
            if (v !== optimizerState.ignoreWeights[k as keyof HeuristicWeights]) {
              toggleIgnoreWeight(k as keyof HeuristicWeights);
            }
          }
        }
        if (data.nodeCount) setNodeCount(data.nodeCount);
        if (data.clusterCount) setClusterCount(data.clusterCount);
        if (data.degreeRatio) setDegreeRatio(data.degreeRatio);
        if (data.edgeWeight) setEdgeWeight(data.edgeWeight);
        if (data.fixedSeed) setFixedSeed(data.fixedSeed);
        if (data.onlyWithinCluster !== undefined) setOnlyWithinCluster(data.onlyWithinCluster);
        
        if (data.autoFit !== undefined) setAutoFit(data.autoFit);
        if (data.showGrid !== undefined) setShowGrid(data.showGrid);
        if (data.showTrails !== undefined) setShowTrails(data.showTrails);
        if (data.trailOpacity !== undefined) setTrailOpacity(data.trailOpacity);
      }
    } catch { /* ignore */ }
  });

  // Clear cache on fresh load (for development)
  localStorage.removeItem(uiState.storageKey);

  // Initialize sigma and build the graph automatically once the container is
  // bound, and regenerate whenever the graph-generation settings change.
  $effect(() => {
    uiState.nodeCount;
    uiState.clusterCount;
    uiState.degreeRatio;
    uiState.edgeWeight;
    uiState.fixedSeed;
    uiState.onlyWithinCluster;
    if (!host) return;
    untrack(() => {
      ensureSigma();
      rebuildGraph();
    });
  });

  function rebuildGraph() {
    const { graph, maxEdgesExceeded } = generateGraph({
      nodeCount: uiState.nodeCount,
      clusterCount: uiState.clusterCount,
      degreeRatio: uiState.degreeRatio,
      edgeWeight: uiState.edgeWeight,
      seed: uiState.fixedSeed,
      onlyWithinCluster: uiState.onlyWithinCluster,
    });

    setGraph(graph);

    if (layoutController) {
      layoutController.updateSettings(getCurrentFA2Settings());
    }

    if (trainer) {
      trainer.stop();
    }

    // Reset layout state
    resetLayoutState();
    optimizerState.currentEpisodeParams = null;
    optimizerState.optimState = null;
    optimizerState.episodeMeans = [];
    optimizerState.episodeItersPerSec = [];

    // Recreate layout controller with new graph
    layoutController = new LayoutController({
      graph,
      settings: getCurrentFA2Settings(),
      optimizer: { featureView: (stat) => optimizer.featureView(stat) },
    });

    // Recreate trainer
    trainer = new LayoutTrainer({
      graph,
      optimizer,
      controller: layoutController,
      callbacks: {
        onEpisodeComplete: (params, reward, context) => {
          addEpisodeMean(reward);
        },
        onEpisodeStart: (params) => {
          optimizerState.currentEpisodeParams = params;
        },
        onIteration: (stat) => {
          // Stats updated by trainer
        },
        onStatsUpdate: (stats) => {
          updateTrainerStats(stats);
        },
      },
      frameBudgetMs: FRAME_BUDGET_MS,
      getIterBudget: () => Math.max(1, Math.round(optimizerState.episodeLength * 1000 / 16)),
      getEpisodeContext: () => layoutState.lastStat
        ? [layoutState.lastStat.edgeLengthCV, layoutState.lastStat.aspectRatio, layoutState.lastStat.motion, layoutState.lastStat.centerDistRatio ?? 0]
        : null,
      isRunning: () => layoutState.running,
      isAutoTune: () => optimizerState.autoTune,
      getCurrentEpisodeParams: () => optimizerState.currentEpisodeParams,
      setCurrentEpisodeParams: (params) => { optimizerState.currentEpisodeParams = params; },
    });

    // Reset to circle and update sigma
    assignUnitCircle(graph);
    const positions = savePositions(graph);
    setPreviousPositions(positions);
    if (layoutController) layoutController.setPreviousPositions(positions);

    if (sigmaInstance) {
      sigmaInstance.setGraph(graph);
      sigmaInstance.refresh();
      if (uiState.autoFit) fitCamera(false);
    }
    // Don't call attachPreviewGraph - it replaces the graph and loses camera fit
    // attachPreviewGraph(true);
  }

  function attachPreviewGraph(forceCircle = false) {
    if (!sigmaInstance || !uiState.currentGraph) return;
    if (forceCircle || isFirstAttach) {
      isFirstAttach = false;
      // assignUnitCircle(uiState.currentGraph); // Already done in rebuildGraph with scaling
    }
    // Build preview graph with best params (or current settings when not auto-tuning)
    const params = getCurrentFA2Settings();
    const preview = buildPreviewGraphFn(params, forceCircle ? 0 : 800);
    if (preview) {
      previewGraph = preview;
      sigmaInstance.setGraph(previewGraph);
      sigmaInstance.refresh();
    }
  }

  function startLayoutFn() {
    if (!uiState.currentGraph || layoutState.running) return;
    previewParams = null;
    previewGraph = null;
    layoutController?.setGraph(uiState.currentGraph);
    sigmaInstance?.setGraph(uiState.currentGraph);
    sigmaInstance?.refresh();
    startLayoutStore();
    optimizer.setWeights(effectiveWeights());
    optimizer.setSigns({ ...optimizerState.signs });
    if (optimizerState.autoTune) {
      optimizerState.episodeMeans = [];
      optimizerState.episodeItersPerSec = [];
      optimizer.start({ ...getCurrentFA2Settings() }, optimizerState.lockedParams);
      optimizerState.optimState = optimizer.getSnapshot();
      trainer?.start();
    }
    runLayoutChunk();
  }

  function stopLayoutFn() {
    stopLayoutStore();
    trainer?.stop();
    if (uiState.currentGraph) {
      const positions = savePositions(uiState.currentGraph);
      setPreviousPositions(positions);
      if (layoutController) layoutController.setPreviousPositions(positions);
      previewParams = null;
      previewGraph = null;
      sigmaInstance?.setGraph(uiState.currentGraph);
      sigmaInstance?.refresh();
    }
  }

  function resetAll() {
    stopLayoutFn();
    resetLayoutState();
    setAutoTune(false);
    optimizerState.currentEpisodeParams = null;
    optimizerState.optimState = null;
    optimizerState.trainerStats = {
      totalEpisodes: 0,
      episodesPerSec: 0,
      lastEpisodeReward: 0,
      bestReward: -Infinity,
      trainingTime: 0,
      iterationsPerSec: 0,
    };
    if (uiState.currentGraph) {
      assignUnitCircle(uiState.currentGraph);
      const positions = savePositions(uiState.currentGraph);
      setPreviousPositions(positions);
      if (layoutController) layoutController.setPreviousPositions(positions);
    }
    previewParams = null;
    previewGraph = null;
    if (sigmaInstance && uiState.currentGraph) {
      sigmaInstance.refresh();
      grid?.draw();
      if (uiState.autoFit) {
        requestAnimationFrame(() => fitCamera(false));
      }
    }
  }

  function getCurrentFA2Settings(): FA2Params {
    const settings = optimizerState.autoTune
      ? (optimizerState.optimState?.bestParams ?? fa2Settings)
      : fa2Settings;
    return { ...settings, scalingRatio: 1, adjustSizes: true };
  }

  function effectiveWeights(): HeuristicWeights {
    const w = {} as HeuristicWeights;
    for (const k of Object.keys(optimizerState.weights) as (keyof HeuristicWeights)[]) {
      w[k] = optimizerState.ignoreWeights[k] ? 0 : optimizerState.weights[k];
    }
    return w;
  }

  function fmt(n: number): string {
    return parseFloat(n.toFixed(3)).toString();
  }

  function tuneSeries(): PlotSeries[] {
    return [
      { label: "episode reward", data: optimizerState.episodeMeans, color: "#f59f00", width: 2 },
      { label: "iters/sec", data: optimizerState.episodeItersPerSec, color: "#3b82f6", width: 1.5 },
    ];
  }

  function buildPreviewGraphFn(params: FA2Params, iterations = 800): Graph | null {
    if (!uiState.currentGraph || uiState.currentGraph.order === 0) return null;
    const g = uiState.currentGraph.copy();
    // Use current positions (already scaled) instead of resetting to unit circle
    // assignUnitCircle(g);
    for (let i = 0; i < iterations; i++) {
      forceAtlas2.assign(g, { iterations: 1, settings: { ...params } });
    }
    let bad = false;
    g.forEachNode((_id, attrs) => {
      const a = attrs as { x: number; y: number };
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) bad = true;
    });
    if (bad) return null;
    return g;
  }

  let previewParams: FA2Params | null = null;
  let previewFrame = 0;

  function stepPreview(dt: number) {
    if (!previewGraph || !sigmaInstance) return;
    if (previewParams === null) {
      previewParams = { ...getCurrentFA2Settings() };
      previewFrame = 0;
    }
    const frames = Math.max(1, Math.round(optimizerState.episodeLength / dt));
    if (previewFrame < frames) {
      forceAtlas2.assign(previewGraph, { iterations: 1, settings: { ...previewParams } });
      previewFrame++;
    } else {
      previewParams = null;
      previewFrame = 0;
    }
    if (sigmaInstance) sigmaInstance.refresh();
  }

  function runLayoutChunk() {
    if (!layoutState.running || !uiState.currentGraph || !layoutController) return;

    const now = performance.now();
    const dt = Math.min((now - layoutState.lastFrameTs) / 1000, 0.25);
    layoutState.lastFrameTs = now;

    // Viewer loop
    if (!optimizerState.autoTune) {
      const result = layoutController.step();
      if (result.stat) {
        recordTick(result.stat, result.positions);
        setHeuristicFeatures(optimizer.featureView(result.stat));
      }
    }

    // Preview loop - always animate the best-params graph
    stepPreview(dt);

    if (sigmaInstance) {
      if (uiState.autoFit) fitCamera(false);
      sigmaInstance.refresh();
    }
    if (showTrails) drawTrails();
    if (layoutState.running) rafId = requestAnimationFrame(runLayoutChunk);
  }

  // --- Sigma setup ---
  function ensureSigma() {
    if (sigmaInstance || !host) return;
    const empty = new Graph({ multi: false });
    let hoveredNode: string | null = null;
    const nodeReducer: NodeReducer = (node, data, _attrs) => {
      const d = { ...data };
      const graph = sigmaInstance?.getGraph();
      if (hoveredNode && graph) {
        if (node === hoveredNode || graph.hasEdge(node, hoveredNode) || graph.hasEdge(hoveredNode, node)) {
          d.zIndex = 1;
        } else {
          d.color = toRgba(String(d.color ?? "#888"), 0.12);
          d.zIndex = 0;
          d.label = "";
        }
      }
      return d;
    };
    const edgeReducer: EdgeReducer = (edge, data, _attrs) => {
      const d = { ...data };
      d.color = toRgba(String(d.color ?? "#888"), 0.45);
      const graph = sigmaInstance?.getGraph();
      if (hoveredNode && graph) {
        const [source, target] = graph.extremities(edge);
        if (source === hoveredNode || target === hoveredNode) {
          d.zIndex = 1;
        } else {
          d.color = toRgba(String(d.color), 0.08);
          d.zIndex = 0;
        }
      }
      return d;
    };
    const s = new Sigma(empty, host, {
      primitives: { nodes: { shapes: [sdfCircle()] } },
      nodeReducer,
      edgeReducer,
      styles: {
        nodes: { size: { attribute: "size" }, color: { attribute: "color" } },
        edges: { size: { attribute: "weight" }, color: { attribute: "color" } },
      },
      settings: { allowInvalidContainer: true, itemSizesReference: "positions", autoRescale: false },
    });
    sigmaInstance = s;
    (window as any).__sigma = s;

    // Shared reference grid (lines + coordinate labels + optional bounds box).
    if (host) {
      grid = createGridOverlay(host, {
        getSigma: () => sigmaInstance,
        getShow: () => uiState.showGrid,
      });
    }

    // Sigma only listens to window resizes, so watch the container directly:
    // when the bottom pane opens/closes (or the sidebar collapses) the graph
    // area resizes and the canvas must follow.
    if (typeof ResizeObserver !== "undefined" && host) {
      containerObserver = new ResizeObserver(() => {
        if (!sigmaInstance) return;
        sigmaInstance.refresh();
        grid?.draw();
        resizeTrailCanvas();
      });
      containerObserver.observe(host);
    }

    s.getCamera().addListener("updated", () => {
      grid?.draw();
      if (untrack(() => showTrails)) drawTrails();
    });

    const mouseCaptor = s.getMouseCaptor();
    let panning = false;
    mouseCaptor.on("wheel", () => setAutoFit(false));
    mouseCaptor.on("mousedown", () => { panning = true; });
    mouseCaptor.on("mousemove", () => { if (panning) setAutoFit(false); });
    mouseCaptor.on("mouseup", () => { panning = false; });

    s.on("enterNode", ({ node }: { node: string }) => {
      hoveredNode = node;
      const nb = new Set<string>([node]);
      uiState.currentGraph?.forEachNeighbor(node, (n) => nb.add(n));
      focusSet = nb;
        s.refresh();
    });

    s.on("leaveNode", () => {
      hoveredNode = null;
      focusSet.clear();
      s.refresh();
    });

    s.on("clickNode", ({ node }: { node: string }) => {
      // Handle click if needed
    });

      s.on("clickStage", () => {
      focusSet.clear();
      s.refresh();
    });
  }

  function destroySigma() {
    if (containerObserver) { containerObserver.disconnect(); containerObserver = null; }
    if (sigmaInstance) { sigmaInstance.kill(); sigmaInstance = null; }
  }

  function resizeTrailCanvas() {
    const c = trailCanvas;
    if (!c) return;
    const dpr = devicePixelRatio || 1;
    const cssW = host?.clientWidth ?? c.width / dpr;
    const cssH = host?.clientHeight ?? c.height / dpr;
    const pxW = Math.round(cssW * dpr);
    const pxH = Math.round(cssH * dpr);
    if (c.width !== pxW || c.height !== pxH) {
      c.width = pxW;
      c.height = pxH;
      c.style.width = cssW + "px";
      c.style.height = cssH + "px";
      clearTrails();
    }
  }

  function fitCamera(animate = true) {
    if (!sigmaInstance) return;
    const graph = sigmaInstance.getGraph();
    void fitViewportToNodes(sigmaInstance, graph.nodes(), { animate });
  }

  function setAutoFitEnabled(enabled: boolean) {
    setAutoFit(enabled);
    if (enabled) fitCamera(true);
  }

  function setGridEnabled(enabled: boolean) {
    setShowGrid(enabled);
    requestAnimationFrame(() => grid?.draw());
  }

  function clearTrails() {
    const c = trailCanvas;
    if (c) c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
  }

  function drawTrails() {
    const c = trailCanvas;
    if (!c || !sigmaInstance || !uiState.currentGraph) return;
    resizeTrailCanvas();
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = devicePixelRatio || 1;
    const cssW = c.width / dpr, cssH = c.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const op = trailOpacity;
    uiState.currentGraph.forEachNode((id, attrs) => {
      const hist = trailHistory.get(id);
      if (!hist || hist.length < 2) return;
      const baseColor = String((attrs as { color: string }).color);
      const n = hist.length;
      for (let i = 0; i < n - 1; i++) {
        const a = (op * (i + 1)) / n;
        const p = sigmaInstance!.graphToViewport({ x: hist[i].x, y: hist[i].y });
        const q = sigmaInstance!.graphToViewport({ x: hist[i + 1].x, y: hist[i + 1].y });
        ctx.strokeStyle = toRgba(baseColor, a);
        ctx.lineWidth = 2 * ((i + 1) / n);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
    });
  }

  function toRgba(hex: string, alpha: number): string {
    const rgb = hex.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${alpha})`;
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  onDestroy(() => {
    stopLayoutFn();
    trainer?.stop();
    destroySigma();
  });
</script>

<div class="flex flex-col h-screen overflow-auto bg-base-100 text-base-content">
  <!-- Top area: sidebar + graph -->
  <div class="flex-1 flex min-h-[420px]">
    <!-- Left sidebar: tabs + settings -->
    <div class="w-72 shrink-0 border-r border-base-300 bg-base-200 flex flex-col relative {sidebarOpen ? '' : 'hidden'}">
      <div
        class="tabs tabs-lift tabs-sm p-1 cursor-pointer"
        role="tablist"
        aria-label="Settings tabs"
        onclick={() => sidebarOpen = !sidebarOpen}
        title="Click to collapse sidebar"
      >
        <button role="tab" aria-selected={uiState.settingsTab === 'fa2'} class="tab tab-sm {uiState.settingsTab === 'fa2' ? 'tab-active' : ''}" onclick={(e) => { e.stopPropagation(); setSettingsTab('fa2'); }} title="ForceAtlas2 layout parameters">ForceAtlas2</button>
        <button role="tab" aria-selected={uiState.settingsTab === 'graph'} class="tab tab-sm {uiState.settingsTab === 'graph' ? 'tab-active' : ''}" onclick={(e) => { e.stopPropagation(); setSettingsTab('graph'); }} title="Graph generation settings">Graph</button>
        <button class="btn btn-sm btn-ghost ml-auto" onclick={(e) => { e.stopPropagation(); sidebarOpen = false; }} title="Collapse sidebar">‹</button>
      </div>

<div class="flex-1 overflow-y-auto p-3" style="min-height: 0;">
        {#if uiState.settingsTab === 'fa2'}
          <div class="flex flex-col gap-2">
            <ParamControls
              params={getCurrentFA2Settings()}
              locked={optimizerState.lockedParams}
              autoTune={optimizerState.autoTune}
              bestParams={optimizerState.optimState?.bestParams}
              onChange={(key, value) => {
                if (optimizerState.autoTune) {
                  optimizer.setIncumbentParam(key, value);
                } else {
                  fa2Settings = { ...fa2Settings, [key]: value };
                  layoutController?.updateSettings(fa2Settings);
                  previewParams = null;
                  if (layoutState.running) attachPreviewGraph();
                }
              }}
              onLockToggle={toggleLock}
              onReset={() => {
                fa2Settings = { ...DEFAULT_FA2_SETTINGS };
                layoutController?.updateSettings(fa2Settings);
                previewParams = null;
                if (layoutState.running) attachPreviewGraph();
                if (optimizerState.autoTune) {
                  for (const [key, value] of Object.entries(DEFAULT_FA2_SETTINGS)) {
                    optimizer.setIncumbentParam(key as keyof FA2Params, value);
                  }
                }
                setLockedParams(new Set());
                if (optimizerState.autoTune && optimizer.isCalibrated()) {
                  optimizer.retarget({ ...getCurrentFA2Settings() }, optimizerState.lockedParams, CONTEXT_DIM);
                }
              }}
            />

              <fieldset class="fieldset border border-base-300 rounded-box p-2">
                <legend class="fieldset-legend text-xs">Layout</legend>
                <div class="flex flex-col gap-1.5">
                  <button
                    class="btn btn-sm btn-block {layoutState.running ? 'btn-warning' : ''}"
                    disabled={!layoutState.running && !uiState.graphReady}
                    onclick={() => layoutState.running ? stopLayoutFn() : startLayoutFn()}
                  >
                    {layoutState.running ? 'Stop Layout' : 'Start Layout'}
                  </button>
                  <button class="btn btn-xs btn-ghost btn-block" onclick={resetAll}>Reset</button>
                </div>
              </fieldset>
            </div>
          {/if}

          {#if uiState.settingsTab === 'graph'}
            <div class="flex flex-col gap-2">
              <div class="flex items-center gap-2 text-xs font-mono">
                <label class="flex items-center gap-2 flex-1 cursor-pointer" title="Total number of nodes">
                  <span class="w-24">Nodes</span>
                  <input type="range" min="1" max="1000" step="1" bind:value={uiState.nodeCount} class="range range-xs flex-1" />
                  <span class="w-10 text-right shrink-0">{uiState.nodeCount}</span>
                </label>
              </div>
              <div class="flex items-center gap-2 text-xs font-mono">
                <label class="flex items-center gap-2 flex-1 cursor-pointer" title="Number of clusters">
                  <span class="w-24">Clusters</span>
                  <input type="range" min="1" max="20" step="1" bind:value={uiState.clusterCount} class="range range-xs flex-1" />
                  <span class="w-10 text-right shrink-0">{uiState.clusterCount}</span>
                </label>
              </div>
              <div class="flex items-center gap-2 text-xs font-mono">
                <label class="flex items-center gap-2 flex-1 cursor-pointer" title="Target edge density (fraction of possible edges)">
                  <span class="w-24">Degree Ratio</span>
                  <input type="range" min="0.01" max="1" step="0.01" bind:value={uiState.degreeRatio} class="range range-xs flex-1" />
                  <span class="w-10 text-right shrink-0">{uiState.degreeRatio.toFixed(2)}</span>
                </label>
              </div>
              <div class="flex items-center gap-2 text-xs font-mono">
                <label class="flex items-center gap-2 flex-1 cursor-pointer" title="Weight applied to generated edges and their visual thickness">
                  <span class="w-24">Edge Weight</span>
                  <input type="range" min="0.25" max="5" step="0.25" bind:value={uiState.edgeWeight} class="range range-xs flex-1" />
                  <span class="w-10 text-right shrink-0">{uiState.edgeWeight.toFixed(2)}</span>
                </label>
              </div>
              <div class="flex items-center gap-2 text-xs font-mono">
                <label class="flex items-center gap-2 flex-1 cursor-pointer" title="Deterministic seed — the graph is identical for the same seed and settings">
                  <span class="w-24 shrink-0">Seed</span>
                  <input type="number" min="0" max="2147483647" step="1" bind:value={uiState.fixedSeed} class="input input-xs input-bordered flex-1" />
                </label>
              </div>
              <div class="flex items-center gap-2 text-xs font-mono">
                <label class="flex items-center gap-2 flex-1 cursor-pointer" title="Only create edges between nodes in the same cluster">
                  <input type="checkbox" bind:checked={uiState.onlyWithinCluster} onchange={() => setOnlyWithinCluster(uiState.onlyWithinCluster)} class="checkbox checkbox-xs" />
                  Only within cluster
                </label>
              </div>

              <div class="mt-2 flex flex-col gap-1">
                <div class="text-[10px] uppercase tracking-wide opacity-60">Est. edges: {estEdgeCount} {estEdgeCount > MAX_EDGES ? '⚠️' : ''} / {MAX_EDGES} max</div>
                <div class="text-[10px] uppercase tracking-wide opacity-60">Clamped: {clampNodeCount({ nodeCount: uiState.nodeCount, clusterCount: uiState.clusterCount, degreeRatio: uiState.degreeRatio, edgeWeight: uiState.edgeWeight, seed: uiState.fixedSeed }).nodeCount !== uiState.nodeCount ? 'yes' : 'no'}</div>
                <div class="text-[10px] uppercase tracking-wide opacity-60">Regenerates automatically when settings change</div>
              </div>
            </div>
          {/if}
        </div>
      </div>

    <!-- Graph canvas -->
    <div class="flex-1 relative min-h-[420px] min-w-[480px]" bind:this={host}>
      <canvas class="absolute inset-0" bind:this={trailCanvas}></canvas>
      <DebugOverlay visible={debugOverlayVisible} stats={layoutState.tickStats} />
      <div class="absolute bottom-3 right-3 z-10 flex flex-col gap-1 rounded bg-base-200/80 p-2 text-xs font-mono backdrop-blur">
        <label class="flex items-center gap-1.5 cursor-pointer" title="Keep the camera fitted to all graph nodes until you pan or zoom">
          <input type="checkbox" checked={uiState.autoFit} onchange={(event) => setAutoFitEnabled(event.currentTarget.checked)} class="checkbox checkbox-xs" />
          Auto-fit
        </label>
        <label class="flex items-center gap-1.5 cursor-pointer" title="Show the coordinate reference grid behind the graph">
          <input type="checkbox" checked={uiState.showGrid} onchange={(event) => setGridEnabled(event.currentTarget.checked)} class="checkbox checkbox-xs" />
          Grid
        </label>
      </div>
    </div>
  </div>

  <!-- Bottom: tabbed Live View / Auto-tune -->
  <div class="shrink-0 border-t border-base-300 bg-base-200 flex flex-col relative">
    <button class="h-2 w-full shrink-0 cursor-pointer hover:bg-primary/20" onclick={toggleBottomOpen} title="Click to toggle bottom panel" aria-label="Toggle bottom panel"></button>
    <div class="tabs tabs-lift tabs-sm p-1" role="tablist" aria-label="Bottom tabs">
      <button role="tab" aria-selected={uiState.bottomTab === 'live'} class="tab tab-sm {uiState.bottomTab === 'live' ? 'tab-active' : ''}" onclick={() => setBottomTab('live')} title="Live layout metrics">Live View</button>
      <button role="tab" aria-selected={uiState.bottomTab === 'autotune'} class="tab tab-sm {uiState.bottomTab === 'autotune' ? 'tab-active' : ''}" onclick={() => setBottomTab('autotune')} title="Auto-tune FA2 parameters">Auto-tune</button>
      <button class="btn btn-sm btn-ghost bg-base-300/80 backdrop-blur ml-auto" onclick={toggleBottomOpen}>{uiState.bottomOpen ? "▼" : "▲"}</button>
    </div>
    {#if uiState.bottomOpen}
      <div class="overflow-y-auto px-3 pb-2" style="max-height: min(22rem, 45vh); min-height: min(22rem, 45vh);">
        {#if uiState.bottomTab === 'live'}
          <LiveViewPanel stats={layoutState.tickStats} running={layoutState.running} />
        {:else if uiState.bottomTab === 'autotune'}
          <fieldset class="fieldset rounded-box p-2 overflow-x-hidden mt-1">
            <div class="flex flex-wrap items-center gap-1.5 mt-1">
              <button type="button" class="btn btn-xs {optimizerState.autoTune ? 'btn-success' : 'btn-primary'}" onclick={handleAutoTuneToggle} title="{optimizerState.autoTune ? 'Stop optimizing and apply the best parameters found so far' : 'Start optimizing FA2 parameters against the heuristic'}">
                {optimizerState.autoTune ? 'Stop optimizing' : 'Start optimizing'}
              </button>
            </div>
            <label class="flex items-center gap-2 text-xs font-mono mt-2" title="Seconds each candidate layout runs before it is scored and (on rejection) rolled back — the episode length">
              <span class="w-24 shrink-0">Episode len</span>
              <input type="range" min="0.5" max="10" step="0.5" bind:value={optimizerState.episodeLength} onchange={() => setEpisodeLength(optimizerState.episodeLength)} class="range range-xs flex-1" />
              <span class="w-12 text-right shrink-0">{optimizerState.episodeLength.toFixed(1)} s</span>
            </label>

            <div class="mt-2 flex flex-col gap-1">
              <div class="text-[10px] uppercase tracking-wide opacity-60">Weights · click effect icon to flip reward/penalise · click name to mute · w = weight · val = feature · H = live contribution{#if optimizerState.autoTune && !optimizer.isCalibrated()} · calibrating…{/if}</div>
              {#each Object.keys(optimizerState.weights) as k}
                <FeatureTooltip k={k} class="flex items-center gap-1.5 text-xs font-mono min-w-0 {optimizerState.ignoreWeights[k] ? 'opacity-40' : ''}">
                  <label class="cursor-pointer shrink-0" title="Ignore this weight (force to 0)">
                    <input type="checkbox" checked={optimizerState.ignoreWeights[k]} onchange={() => toggleIgnoreWeight(k)} class="checkbox checkbox-xs checkbox-ghost" />
                  </label>
                  <span class="w-16 shrink-0 truncate cursor-pointer" title="{optimizerState.weights[k]}" onclick={() => toggleIgnoreWeight(k)}>{k}</span>
                  <button type="button" class="badge badge-xs {optimizerState.signs[k] === 1 ? 'badge-success' : 'badge-error'} shrink-0 cursor-pointer" onclick={() => { optimizerState.signs[k] = optimizerState.signs[k] === 1 ? -1 : 1; optimizer.setSigns({ ...optimizerState.signs }); }}>{optimizerState.signs[k] === 1 ? '+' : '−'}</button>
                  <input type="range" min="0" max="3" step="0.1" bind:value={optimizerState.weights[k]} class="range range-xs flex-1 min-w-0" disabled={optimizerState.ignoreWeights[k]} />
                  <span class="w-8 text-right shrink-0">{fmt(optimizerState.weights[k])}</span>
                  <span class="w-10 text-right shrink-0 font-mono" style="color: var(--p);">{optimizerState.optimState?.featureView ? fmt((optimizerState.optimState.featureView as unknown as Record<string, number>)[k] ?? 0) : '—'}</span>
                  <span class="w-10 text-right shrink-0 font-mono" style="color: var(--p);">{fmt(optimizerState.optimState?.featureView ? ((optimizerState.signs[k] as 1 | -1) * optimizerState.weights[k] * (optimizerState.optimState.featureView as unknown as Record<string, number>)[k] ?? 0) : 0)}</span>
                </FeatureTooltip>
              {/each}
            </div>

            <div class="mt-2">
              <div class="text-[10px] uppercase tracking-wide opacity-60 mb-1">Episode reward · mean per episode (legend = latest)</div>
              <ScorePlot series={tuneSeries()} />
            </div>

            {#if optimizerState.optimState}
              <div class="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div class="font-mono">
                  <div>Best params view</div>
                  <div>Iter: {optimizerState.optimState.episode}</div>
                  <div class="text-[10px] opacity-70">{formatParams(optimizerState.optimState.bestParams)}</div>
                </div>
                <div class="font-mono">
                  <div>Trainer</div>
                  <div>{optimizerState.trainerStats.totalEpisodes} (background)</div>
                  <div class="text-[10px] opacity-70">Ep/s: {optimizerState.trainerStats.episodesPerSec.toFixed(1)}</div>
                </div>
                <div class="font-mono col-span-2">
                  <div>Episodes: {optimizerState.trainerStats.totalEpisodes}</div>
                  <div class="text-[10px] opacity-70">Iters/s: {optimizerState.trainerStats.iterationsPerSec.toFixed(0)} | Time: {optimizerState.trainerStats.trainingTime.toFixed(1)}s</div>
                </div>
                <div class="font-mono col-span-2">
                  <div>Best reward: {optimizerState.trainerStats.bestReward.toFixed(3)}</div>
                  <div class="text-[10px] opacity-70">Exploration {optimizerState.optimState.explorationPct}% / Exploitation {optimizerState.optimState.exploitationPct}%</div>
                </div>
              </div>
            {/if}

            <div class="mt-2 flex flex-wrap gap-1">
              <button class="btn btn-xs btn-primary" onclick={() => copyBestParams()}>Copy Best Params</button>
              <button class="btn btn-xs btn-secondary" onclick={() => applyBestParams()}>Apply Best</button>
            </div>
          </fieldset>
        {/if}
      </div>
    {/if}
  </div>
</div>
<script context="module">
  function formatParams(p: FA2Params): string {
    const PARAM_SHORT: Record<string, string> = {
      gravity: "Grav", slowDown: "Slow", scalingRatio: "Scal",
      barnesHutTheta: "BHT", edgeWeightInfluence: "EWt",
      strongGravityMode: "SG", barnesHutOptimize: "BHO",
      outboundAttractionDistribution: "OB", linLogMode: "LL", adjustSizes: "AS",
    };
    return (Object.keys(PARAM_SHORT) as (keyof FA2Params)[])
      .map((k) => `${PARAM_SHORT[k]}=${typeof p[k] === "boolean" ? (p[k] ? "✓" : "✗") : p[k]}`)
      .join(" ");
  }

  function copyBestParams() {
    if (!optimizerState.optimState) return;
    const p = optimizerState.optimState.bestParams;
    const text = formatParams(p);
    navigator.clipboard.writeText(text);
  }

  function applyBestParams() {
    if (!optimizerState.optimState) return;
    const p = optimizerState.optimState.bestParams;
    for (const k of Object.keys(p) as (keyof FA2Params)[]) {
      if (optimizerState.lockedParams.has(k)) {
        optimizer.setIncumbentParam(k, p[k]);
      }
    }
  }
</script>
