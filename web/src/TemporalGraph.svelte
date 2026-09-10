<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import Sigma from "sigma";
  import { createGridOverlay, type GridOverlay } from "./graph/grid";
  import { fitAll } from "./graph/camera";
  import { TimelineController } from "./TimelineController";
  import { createTemporalEdgeReducer, createTemporalNodeReducer } from "./graph/reducers";
  import type { DatasetLike } from "./temporal/types";

  type TemporalFilters = { teamId: number | null; minMatchCount: number; edgeColorMode: "shared" | "winRate" | "recency"; selectedId: string | null; partnerId: string | null; matchPlayerIds: Set<string> | null };
  let { dataset, time, grid = false, autoFit = true, trails = false, fitRequest = 0, initialPosition = "min", filters, onAutoFitChange = () => {}, onReady = () => {}, onTime = () => {}, onPlayingChange = () => {}, onSelect = () => {} }: { dataset: DatasetLike; time: number; grid?: boolean; autoFit?: boolean; trails?: boolean; fitRequest?: number; initialPosition?: "min" | "max"; filters: TemporalFilters; onAutoFitChange?: (enabled: boolean) => void; onReady?: (controller: TimelineController) => void; onTime?: (time: number) => void; onPlayingChange?: (playing: boolean) => void; onSelect?: (node: string | null) => void } = $props();
  let host = $state<HTMLElement | null>(null);
  let controller = $state<TimelineController | null>(null);
  let layoutIdentity = $state(0);
  let layoutReloads = $state(0);
  let nodeCount = $state(0);
  let edgeCount = $state(0);
  let seekRequests = $state(0);
  let seekApplies = $state(0);
  let sigma: Sigma | null = null;
  let gridOverlay: GridOverlay | null = null;
  let cameraFrame: number | null = null;
  let gridFrame: number | null = null;
  let trailFrame: number | null = null;
  let trailCanvas: HTMLCanvasElement | null = null;
  const trailsByNode = new Map<string, Array<{ x: number; y: number }>>();

  function updateTopologyStats(source: TimelineController | null): void {
    layoutIdentity = source?.layout.identity ?? 0;
    layoutReloads = source?.layout.topologyReloads ?? 0;
    nodeCount = source?.activeNodeCount ?? 0;
    edgeCount = source?.activeEdgeCount ?? 0;
    seekRequests = source?.seekRequests ?? 0;
    seekApplies = source?.seekApplies ?? 0;
  }

  function fitGraph(): void { fitAll(sigma, controller?.graph ?? null, { animate: false }); }
  function drawTrails(): void {
    const canvas = trailCanvas;
    if (!canvas || !host || !sigma || !controller) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) { canvas.width = width * dpr; canvas.height = height * dpr; canvas.style.width = `${width}px`; canvas.style.height = `${height}px`; }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!trails) { trailsByNode.clear(); return; }
    controller.graph.forEachNode((node, attrs) => {
      const point = sigma!.graphToViewport({ x: Number(attrs.x), y: Number(attrs.y) });
      const points = trailsByNode.get(node) ?? [];
      points.push(point);
      if (points.length > 20) points.shift();
      trailsByNode.set(node, points);
      if (points.length < 2) return;
      context.beginPath(); context.moveTo(points[0]!.x, points[0]!.y);
      for (const previous of points.slice(1)) context.lineTo(previous.x, previous.y);
      context.strokeStyle = "#64748b"; context.globalAlpha = 0.35; context.lineWidth = 1; context.stroke();
    });
    context.globalAlpha = 1;
    trailFrame = requestAnimationFrame(drawTrails);
  }

  $effect(() => {
    if (!host) return;
    const graphHost = host;
    const notifyTime = untrack(() => onTime);
    const notifyPlayingChange = untrack(() => onPlayingChange);
    const notifyReady = untrack(() => onReady);
    const notifySelection = untrack(() => onSelect);
    // UI resets seek this controller; initialPosition must not recreate FA2.
    let constructed: TimelineController | null = null;
    const nextController = new TimelineController(dataset, (currentTime) => { if (constructed) updateTopologyStats(constructed); notifyTime(currentTime); }, notifyPlayingChange, untrack(() => initialPosition));
    constructed = nextController;
    controller = nextController;
    updateTopologyStats(nextController);
    sigma = untrack(() => new Sigma(nextController.graph, graphHost, {
      nodeReducer: createTemporalNodeReducer({ graph: () => nextController.graph, temporalIndex: () => nextController.temporalIndex, time: () => time, teamId: () => filters.teamId, minMatchCount: () => filters.minMatchCount, edgeColorMode: () => filters.edgeColorMode, selectedId: () => filters.selectedId, partnerId: () => filters.partnerId, matchPlayerIds: () => filters.matchPlayerIds }),
      edgeReducer: createTemporalEdgeReducer({ graph: () => nextController.graph, temporalIndex: () => nextController.temporalIndex, time: () => time, teamId: () => filters.teamId, minMatchCount: () => filters.minMatchCount, edgeColorMode: () => filters.edgeColorMode, selectedId: () => filters.selectedId, partnerId: () => filters.partnerId, matchPlayerIds: () => filters.matchPlayerIds }),
    }));
    gridOverlay = createGridOverlay(graphHost, { getSigma: () => sigma, getShow: () => grid });
    const onCameraInput = () => {
      if (cameraFrame !== null) cancelAnimationFrame(cameraFrame);
      cameraFrame = requestAnimationFrame(() => {
        cameraFrame = null;
        graphHost.dataset.cameraState = JSON.stringify(sigma?.getCamera().getState() ?? {});
      });
      if (autoFit) onAutoFitChange(false);
    };
    graphHost.addEventListener("wheel", onCameraInput, { capture: true, passive: true });
    graphHost.addEventListener("mousedown", onCameraInput, true);
    nextController.attachRenderer(sigma);
    graphHost.dataset.cameraState = JSON.stringify(sigma.getCamera().getState());
    sigma.on("clickNode", ({ node }) => notifySelection(node));
    notifyReady(nextController);
    return () => { if (cameraFrame !== null) cancelAnimationFrame(cameraFrame); if (gridFrame !== null) cancelAnimationFrame(gridFrame); if (trailFrame !== null) cancelAnimationFrame(trailFrame); graphHost.removeEventListener("wheel", onCameraInput, true); graphHost.removeEventListener("mousedown", onCameraInput, true); gridOverlay?.destroy(); gridOverlay = null; sigma?.kill(); nextController.dispose(); sigma = null; controller = null; };
  });

  $effect(() => { if (controller && time !== controller.currentTime) { controller.requestSeek(time); updateTopologyStats(controller); } });
  $effect(() => { time; updateTopologyStats(controller); });
  $effect(() => { filters.teamId; filters.minMatchCount; filters.edgeColorMode; filters.selectedId; filters.partnerId; filters.matchPlayerIds; time; sigma?.refresh(); });
  $effect(() => { grid; if (gridFrame !== null) cancelAnimationFrame(gridFrame); gridFrame = requestAnimationFrame(() => { gridFrame = null; gridOverlay?.draw(); }); });
  $effect(() => { autoFit; fitRequest; if (autoFit) fitGraph(); });
  $effect(() => { trails; if (trailFrame !== null) cancelAnimationFrame(trailFrame); trailFrame = requestAnimationFrame(drawTrails); });
  onDestroy(() => { sigma?.kill(); controller?.dispose(); });
</script>

<div class="relative h-full min-h-[420px] w-full" data-testid="main-graph" data-grid-enabled={grid} data-trails-enabled={trails} data-layout-worker-id={layoutIdentity} data-layout-reloads={layoutReloads} data-node-count={nodeCount} data-edge-count={edgeCount} data-seek-requests={seekRequests} data-seek-applies={seekApplies} bind:this={host}><canvas class="pointer-events-none absolute inset-0" bind:this={trailCanvas}></canvas></div>
