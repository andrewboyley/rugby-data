<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import Graph from "graphology";
  import { circular } from "graphology-layout";
  import forceAtlas2 from "graphology-layout-forceatlas2";
  import Sigma from "sigma";
  import { sdfCircle } from "sigma/rendering";
  import { getCameraStateToFitViewportToNodes } from "@sigma/utils";
  import LiveViewPanel from "./LiveViewPanel.svelte";
  import ScorePlot, { type PlotSeries } from "./ScorePlot.svelte";
  import DebugOverlay from "./DebugOverlay.svelte";
  import ParamControls from "./components/ParamControls.svelte";
  import FeatureTooltip from "./components/FeatureTooltip.svelte";
  import type { FA2Params, HeuristicWeights } from "./graph/layout-optimizer";
import { LayoutController } from "./graph";
import { LayoutTrainer } from "./graph";
import { FA2OptimizerAdapter } from "./graph";
import { generateGraph, estimateEdges, clampNodeCount, MAX_EDGES, savePositions } from "./graph";
import { layoutState, startLayout as startLayoutStore, stopLayout as stopLayoutStore, resetLayoutState, recordTick, setHeuristicFeatures, setPreviousPositions } from "./stores/layout-store.svelte";
import { optimizerState, setAutoTune, setEpisodeLength, setWeights, setSigns, toggleIgnoreWeight, toggleLock, setLockedParams, updateTrainerStats, addEpisodeMean } from "./stores/optimizer-store.svelte";
import { uiState, setGraph, setSettingsTab, setBottomTab, toggleBottomOpen, setNodeCount, setClusterCount, setDegreeRatio, setUseFixedSeed, setFixedSeed, setAutoFit, setShowGrid, setShowTrails, setTrailOpacity, setEnforceBounds, setBoundsMaxX, setBoundsMaxY } from "./stores/ui-store.svelte";
import { createGridOverlay, type GridOverlay } from "./graph/grid.ts";

  const CLUSTER_COLORS = [
    "#e03131", "#1971c2", "#40c057", "#fa923f",
    "#862e9c", "#e8590c", "#109868", "#0b7285",
    "#c2255c", "#5c940d", "#9c36b5", "#e67700",
  ];

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
  let suppressCameraUpdate = false;
  let sidebarOpen = $state(true);
  let debugOverlayVisible = false;

  let layoutController: LayoutController | null = null;
  let trainer: LayoutTrainer | null = null;
  let optimizer = new FA2OptimizerAdapter(true);

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
    seed: uiState.fixedSeed,
  }));

  // Clamp node count when params change
  $effect(() => {
    const clamped = clampNodeCount({
      nodeCount: uiState.nodeCount,
      clusterCount: uiState.clusterCount,
      degreeRatio: uiState.degreeRatio,
      seed: uiState.fixedSeed,
    });
    if (clamped.nodeCount !== uiState.nodeCount) {
      setNodeCount(clamped.nodeCount);
    }
  });

  // Update optimizer weights when they change during auto-tune
  $effect(() => {
    if (optimizerState.autoTune) {
      optimizer.setWeights(effectiveWeights());
      optimizer.setSigns({ ...optimizerState.signs });
    }
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
        useFixedSeed: true,
        fixedSeed: uiState.fixedSeed,
        autoFit: uiState.autoFit,
        showGrid: uiState.showGrid,
        showTrails: uiState.showTrails,
        trailOpacity: uiState.trailOpacity,
        enforceBounds: uiState.enforceBounds,
        boundsMaxX: uiState.boundsMaxX,
        boundsMaxY: uiState.boundsMaxY,
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
        if (data.fixedSeed) setFixedSeed(data.fixedSeed);
        
        if (data.autoFit !== undefined) setAutoFit(data.autoFit);
        if (data.showGrid !== undefined) setShowGrid(data.showGrid);
        if (data.showTrails !== undefined) setShowTrails(data.showTrails);
        if (data.trailOpacity !== undefined) setTrailOpacity(data.trailOpacity);
        if (data.enforceBounds !== undefined) setEnforceBounds(data.enforceBounds);
        if (data.boundsMaxX !== undefined) setBoundsMaxX(data.boundsMaxX);
        if (data.boundsMaxY !== undefined) setBoundsMaxY(data.boundsMaxY);
      }
    } catch { /* ignore */ }
  });

  // Clear cache on fresh load (for development)
  localStorage.removeItem(uiState.storageKey);

  // Initialize sigma and build the initial graph
  ensureSigma();
  rebuildGraph();

  function rebuildGraph() {
    const { graph, maxEdgesExceeded } = generateGraph({
      nodeCount: uiState.nodeCount,
      clusterCount: uiState.clusterCount,
      degreeRatio: uiState.degreeRatio,
      seed: uiState.useFixedSeed ? uiState.fixedSeed : Math.floor(Math.random() * 1e9),
    });

    setGraph(graph);

    if (layoutController) {
      layoutController.updateSettings(optimizerState.optimState?.bestParams ?? {
        gravity: 1, slowDown: 1, scalingRatio: 10, strongGravityMode: false,
        barnesHutOptimize: true, barnesHutTheta: 0.5, edgeWeightInfluence: 1,
        outboundAttractionDistribution: false, linLogMode: false, adjustSizes: false,
      });
      layoutController.updateBounds(uiState.enforceBounds, uiState.boundsMaxX, uiState.boundsMaxY);
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
      settings: optimizerState.optimState?.bestParams ?? {
        gravity: 1, slowDown: 1, scalingRatio: 10, strongGravityMode: false,
        barnesHutOptimize: true, barnesHutTheta: 0.5, edgeWeightInfluence: 1,
        outboundAttractionDistribution: false, linLogMode: false, adjustSizes: false,
      },
      enforceBounds: uiState.enforceBounds,
      boundsMaxX: uiState.boundsMaxX,
      boundsMaxY: uiState.boundsMaxY,
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
    circular.assign(graph, { scale: 100 });
    const positions = savePositions(graph);
    setPreviousPositions(positions);
    if (layoutController) layoutController.setPreviousPositions(positions);

    if (sigmaInstance) {
      sigmaInstance.setGraph(graph);
      sigmaInstance.refresh({ skipIndexation: true });
      freezeGridBBox();
    }
    attachPreviewGraph();
  }

  function attachPreviewGraph(forceCircle = false) {
    if (!sigmaInstance || !uiState.currentGraph) return;
    if (forceCircle || isFirstAttach) {
      isFirstAttach = false;
      circular.assign(uiState.currentGraph, { scale: 100 });
    }
    // Build preview graph with best params (or current settings when not auto-tuning)
    const params = getCurrentFA2Settings();
    const preview = buildPreviewGraphFn(params, forceCircle ? 0 : 800);
    if (preview) {
      previewGraph = preview;
      sigmaInstance.setGraph(previewGraph);
      sigmaInstance.refresh({ skipIndexation: true });
      freezeGridBBox();
    }
  }

  function startLayoutFn() {
    if (!uiState.currentGraph || layoutState.running) return;
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
      circular.assign(uiState.currentGraph, { scale: 100 });
      const positions = savePositions(uiState.currentGraph);
      setPreviousPositions(positions);
      if (layoutController) layoutController.setPreviousPositions(positions);
    }
    attachPreviewGraph();
  }

  function resetAll() {
    stopLayoutFn();
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
      circular.assign(uiState.currentGraph, { scale: 100 });
      const positions = savePositions(uiState.currentGraph);
      setPreviousPositions(positions);
      if (layoutController) layoutController.setPreviousPositions(positions);
    }
    attachPreviewGraph();
  }

  function getCurrentFA2Settings(): FA2Params {
    return {
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
    };
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
    circular.assign(g, { scale: 100 });
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
    if (sigmaInstance) sigmaInstance.refresh({ skipIndexation: true });
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

    if (sigmaInstance) sigmaInstance.refresh({ skipIndexation: true });
    if (uiState.showGrid || uiState.enforceBounds) grid?.draw();
    if (showTrails) drawTrails();
    if (uiState.autoFit) fitCamera(false);

    if (layoutState.running) rafId = requestAnimationFrame(runLayoutChunk);
  }

  // --- Sigma setup ---
  function ensureSigma() {
    if (sigmaInstance || !host) return;
    const empty = new Graph({ multi: false });
    const s = new Sigma(empty, host, {
      primitives: { nodes: { shapes: [sdfCircle()] } },
      styles: {
        nodes: [{ color: { attribute: "color" }, size: { attribute: "size" } }],
        edges: [{ color: { attribute: "color" } }],
      },
      settings: { allowInvalidContainer: true, itemSizesReference: "screen" },
    });
    sigmaInstance = s;
    (window as any).__sigma = s;

    // Shared reference grid (lines + coordinate labels + optional bounds box).
    if (host) {
      grid = createGridOverlay(host, {
        getSigma: () => sigmaInstance,
        getGraph: () => uiState.currentGraph,
        getShow: () => uiState.showGrid || uiState.enforceBounds,
        getBounds: () => (uiState.enforceBounds ? { maxX: uiState.boundsMaxX, maxY: uiState.boundsMaxY } : null),
      });
    }

    s.getCamera().addListener("updated", () => {
      grid?.draw();
      if (untrack(() => showTrails)) drawTrails();
      if (!suppressCameraUpdate && untrack(() => uiState.autoFit)) uiState.autoFit = false;
    });

    s.setSetting("nodeReducer", (node, data) => {
      const d = { ...data } as Record<string, unknown>;
      if (focusSet.size > 0) {
        if (focusSet.has(node)) {
          d.zIndex = 1;
        } else {
          d.color = toRgba(String(d.color ?? "#888"), 0.12);
          d.zIndex = 0;
          d.label = "";
        }
      }
      return d as never;
    });

    s.setSetting("edgeReducer", (edge, data) => {
      const d = { ...data } as Record<string, unknown>;
      if (focusSet.size > 0 && uiState.currentGraph) {
        const src = uiState.currentGraph.source(edge);
        const tgt = uiState.currentGraph.target(edge);
        if (focusSet.has(src) && focusSet.has(tgt)) {
          d.zIndex = 1;
        } else {
          if (typeof d.color === "string") d.color = toRgba(d.color, 0.08);
          d.zIndex = 0;
        }
      }
      return d as never;
    });

    s.on("enterNode", ({ node }: { node: string }) => {
      const nb = new Set<string>([node]);
      uiState.currentGraph?.forEachNeighbor(node, (n) => nb.add(n));
      focusSet = nb;
      s.refresh({ skipIndexation: true });
    });

    s.on("leaveNode", () => {
      focusSet.clear();
      s.refresh({ skipIndexation: true });
    });

    s.on("clickNode", ({ node }: { node: string }) => {
      // Handle click if needed
    });

    s.on("clickStage", () => {
      focusSet.clear();
      s.refresh({ skipIndexation: true });
      if (uiState.autoFit) {
        fitAll(s, uiState.currentGraph!, { animate: true });
        uiState.autoFit = false;
      }
    });
  }

  function destroySigma() {
    if (containerObserver) { containerObserver.disconnect(); containerObserver = null; }
    if (sigmaInstance) { sigmaInstance.kill(); sigmaInstance = null; }
  }

  function freezeGridBBox() {
    if (!sigmaInstance || !uiState.currentGraph || uiState.currentGraph.order === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    uiState.currentGraph.forEachNode((_id, a) => {
      const na = a as { x: number; y: number };
      if (na.x < minX) minX = na.x;
      if (na.x > maxX) maxX = na.x;
      if (na.y < minY) minY = na.y;
      if (na.y > maxY) maxY = na.y;
    });
    sigmaInstance.setCustomBBox({ x: [minX, maxX], y: [minY, maxY] });
  }

  function fitCamera(animate = true) {
    if (!sigmaInstance || !uiState.currentGraph) return;
    const state = getCameraStateToFitViewportToNodes(sigmaInstance, uiState.currentGraph, { padding: 20 });
    sigmaInstance.getCamera().animate({ ...state, duration: animate ? 400 : 0 });
  }

  function fitAll(s: Sigma, g: Graph, opts: { animate: boolean }) {
    const state = getCameraStateToFitViewportToNodes(s, g, { padding: 20 });
    s.getCamera().animate({ ...state, duration: opts.animate ? 400 : 0 });
  }

  function clearTrails() {
    const c = trailCanvas;
    if (c) c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
  }

  function drawTrails() {
    const c = trailCanvas;
    if (!c || !sigmaInstance || !uiState.currentGraph) return;
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

<div class="flex flex-col h-screen bg-base-100 text-base-content">
  <!-- Top area: sidebar + graph -->
  <div class="flex-1 flex min-h-0">
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
                }
              }}
              onLockToggle={toggleLock}
            />

              <fieldset class="fieldset border border-base-300 rounded-box p-2">
                <legend class="fieldset-legend text-xs flex items-center gap-1">
                  Options
                  <span class="badge badge-xs badge-ghost">🔒 = locked from optimizer</span>
                </legend>
                <div class="flex flex-col gap-1">
                  {#each [
                    { key: "strongGravityMode", label: "Strong Gravity", title: "Force all nodes toward center regardless of edges" },
                    { key: "barnesHutOptimize", label: "BH Optimize", title: "Use Barnes-Hut quadtree approximation for repulsion" },
                    { key: "outboundAttractionDistribution", label: "Outbound", title: "Distribute attraction force to outbound edges" },
                    { key: "linLogMode", label: "LinLog", title: "Logarithmic attraction for high-degree nodes" },
                    { key: "adjustSizes", label: "Adjust Sizes", title: "Adjust node sizes based on degree" },
                  ] as item}
                    <div class="flex items-center gap-1.5 text-xs font-mono cursor-pointer">
                      <label class="flex items-center gap-1.5 flex-1 cursor-pointer" title={item.title}>
                        <input type="checkbox" checked={getCurrentFA2Settings()[item.key] as boolean} class="checkbox checkbox-xs" disabled={optimizerState.autoTune && !optimizerState.lockedParams.has(item.key)} onchange={(e) => {
                          if (!optimizerState.autoTune || optimizerState.lockedParams.has(item.key)) {
                            if (optimizerState.autoTune) {
                              optimizer.setIncumbentParam(item.key, e.currentTarget.checked);
                            }
                          }
                        }} />
                        {item.label}
                      </label>
                      <button type="button" class="btn btn-xs btn-ghost px-1 min-h-0 h-5 {optimizerState.lockedParams.has(item.key) ? 'text-warning' : 'text-base-content/30'}" onclick={() => handleLockToggle(item.key)} title="Lock from optimizer">{optimizerState.lockedParams.has(item.key) ? '🔒' : '🔓'}</button>
                    </div>
                  {/each}
                </div>
                <div class="flex gap-2 mt-2">
                  <button class="btn btn-xs btn-ghost btn-block" onclick={() => {
                    optimizer.setIncumbentParam("gravity", 1);
                    optimizer.setIncumbentParam("slowDown", 1);
                    optimizer.setIncumbentParam("scalingRatio", 10);
                    optimizer.setIncumbentParam("barnesHutTheta", 0.5);
                    optimizer.setIncumbentParam("edgeWeightInfluence", 1);
                    optimizer.setIncumbentParam("strongGravityMode", false);
                    optimizer.setIncumbentParam("barnesHutOptimize", true);
                    optimizer.setIncumbentParam("outboundAttractionDistribution", false);
                    optimizer.setIncumbentParam("linLogMode", false);
                    optimizer.setIncumbentParam("adjustSizes", false);
                    setLockedParams(new Set());
                    if (optimizerState.autoTune && optimizer.isCalibrated()) {
                      optimizer.retarget({ ...getCurrentFA2Settings() }, optimizerState.lockedParams, CONTEXT_DIM);
                    }
                  }}>Reset</button>
                </div>
              </fieldset>

              <fieldset class="fieldset border border-base-300 rounded-box p-2">
                <legend class="fieldset-legend text-xs">Bounds · dashed = clamp box</legend>
                <div class="flex flex-col gap-1.5">
                  <label class="flex items-center gap-1.5 text-xs font-mono cursor-pointer" title="Clamp every node to [−max, +max] on each axis each layout tick">
                    <input type="checkbox" bind:checked={uiState.enforceBounds} class="checkbox checkbox-xs" />
                    Clamp to box
                  </label>
                  <label class="flex items-center gap-2 text-xs font-mono" title="Max |x| — nodes clamped to ± this">
                    <span class="w-14 shrink-0 opacity-70">Max |x|</span>
                    <input type="range" min="50" max="2000" step="50" bind:value={uiState.boundsMaxX} class="range range-xs flex-1" disabled={!uiState.enforceBounds} />
                    <span class="w-10 text-right shrink-0">{uiState.boundsMaxX}</span>
                  </label>
                  <label class="flex items-center gap-2 text-xs font-mono" title="Max |y| — nodes clamped to ± this">
                    <span class="w-14 shrink-0 opacity-70">Max |y|</span>
                    <input type="range" min="50" max="1500" step="50" bind:value={uiState.boundsMaxY} class="range range-xs flex-1" disabled={!uiState.enforceBounds} />
                    <span class="w-10 text-right shrink-0">{uiState.boundsMaxY}</span>
                  </label>
                </div>
              </fieldset>

              <fieldset class="fieldset border border-base-300 rounded-box p-2">
                <legend class="fieldset-legend text-xs">Layout</legend>
                <div class="flex flex-col gap-1.5">
                  <button class="btn btn-sm btn-block" disabled={layoutState.running || !uiState.graphReady} onclick={startLayoutFn}>
                    Start Layout
                  </button>
                  <button class="btn btn-sm btn-warning btn-block" disabled={!layoutState.running} onclick={stopLayoutFn}>
                    Stop Layout
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
                  <input type="range" min="10" max="2000" step="10" bind:value={uiState.nodeCount} class="range range-xs flex-1" />
                  <span class="w-10 text-right shrink-0">{uiState.nodeCount}</span>
                </label>
              </div>
              <div class="flex items-center gap-2 text-xs font-mono">
                <label class="flex items-center gap-2 flex-1 cursor-pointer" title="Number of clusters">
                  <span class="w-24">Clusters</span>
                  <input type="range" min="1" max="50" step="1" bind:value={uiState.clusterCount} class="range range-xs flex-1" />
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
                <label class="flex items-center gap-2 flex-1 cursor-pointer" title="Use fixed seed for reproducibility">
                  <input type="checkbox" bind:checked={uiState.useFixedSeed} class="checkbox checkbox-xs" />
                  Fixed Seed
                </label>
                <input type="number" min="0" max="2147483647" step="1" bind:value={uiState.fixedSeed} class="input input-xs input-bordered w-20" disabled={!uiState.useFixedSeed} />
              </div>

              <div class="mt-2 flex flex-col gap-1">
                <div class="text-[10px] uppercase tracking-wide opacity-60">Est. edges: {estEdgeCount} {estEdgeCount > MAX_EDGES ? '⚠️' : ''} / {MAX_EDGES} max</div>
                <div class="text-[10px] uppercase tracking-wide opacity-60">Clamped: {clampNodeCount({ nodeCount: uiState.nodeCount, clusterCount: uiState.clusterCount, degreeRatio: uiState.degreeRatio, seed: uiState.fixedSeed }).nodeCount !== uiState.nodeCount ? 'yes' : 'no'}</div>
              </div>

<button class="btn btn-sm btn-block mt-2" onclick={rebuildGraph}>Regenerate Graph</button>
            </div>
          {/if}
        </div>
      </div>

    <!-- Graph canvas -->
    <div class="flex-1 relative min-w-0" bind:this={host}>
      <canvas class="absolute inset-0" bind:this={trailCanvas}></canvas>
      <DebugOverlay visible={debugOverlayVisible} stats={layoutState.tickStats} />
      <div class="absolute top-2 right-2 flex flex-col gap-1">
        <button class="btn btn-sm btn-ghost btn-circle" onclick={() => sidebarOpen = !sidebarOpen} title="Toggle sidebar">☰</button>
        <button class="btn btn-sm btn-ghost btn-circle" onclick={() => debugOverlayVisible = !debugOverlayVisible} title="Toggle debug overlay">🐛</button>
        <button class="btn btn-sm btn-ghost btn-circle" onclick={goHome} title="Back to main">←</button>
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
      <div class="overflow-y-auto px-3 pb-2" style="max-height: 22rem; min-height: 22rem;">
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