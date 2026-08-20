// GraphController: imperative sigma/graph lifecycle.
// Extracted from Graph.svelte so the component stays declarative.

import Sigma from "sigma";
import { UndirectedGraph } from "graphology";
import { createSigmaOptions } from "./graph/programs.ts";
import { createNodeReducer, createEdgeReducer, type StateGetters } from "./graph/reducers.ts";
import { createPositionStore, type PositionStore } from "./graph/positions.ts";
import { createLayoutManager, circularSeed, type LayoutTickStats } from "./graph/layout.ts";
import { fitAll, fitToNodes, normalizePositions, zoomToTeam as zoomCameraToTeam } from "./graph/camera.ts";
import { createClusterLabels } from "./graph/cluster-labels.ts";
import { createActiveEdgeOverlay } from "./graph/active-edge.ts";
import { createSpinRing } from "./graph/spin-ring.ts";
import { edgeSelection } from "./graph/edge-detail.ts";
import { buildGraph, type _BuildGraphOpts } from "./graph/build-graph.ts";
import { clearSubsetCache } from "./lib.ts";
import { nodeFillColor } from "./graph/colors.ts";
import { createMetaballs } from "./graph/metaballs.ts";
import { createGridOverlay, type GridOverlay } from "./graph/grid.ts";
import type { CameraState } from "sigma/types";
import type {
  Player,
  Link,
  ParsedGraph,
  GraphControllerCallbacks,
} from "./types.ts";

export interface GraphControllerOpts {
  host: HTMLElement;
  initialGraph: ParsedGraph;
  prevPos: PositionStore["positions"];
  callbacks: GraphControllerCallbacks;
  getTeams: () => Record<number, { name: string; color: string; alternateColor?: string }>;
  getNodeColor: () => string;
  getEdgeColor: () => string;
  getAlphaMin: () => number;
  getAlphaMax: () => number;
  getWinRates: () => Map<string, number>;
  getShowEdges: () => boolean;
  getShowMetaballs: () => boolean;
  getShowGrid: () => boolean;
  getMatchEventId: () => number | null;
  getViewNodes: () => Player[];
  getViewLinks: () => Link[];
  getSelectedId: () => number | null;
  getSecondaryId: () => number | null;
}

export class GraphController {
  private sigma: Sigma | null = null;
  private graph: UndirectedGraph | null = null;
  private layoutManager: { start: () => void; dispose: () => void } | null = null;
  private clusterLabels: ReturnType<typeof createClusterLabels> | null = null;
  private activeEdgeOverlay: ReturnType<typeof createActiveEdgeOverlay> | null = null;
  private spinRing: ReturnType<typeof createSpinRing> | null = null;
  private positionStore: PositionStore;
  private graphStepHandler: (() => void) | null = null;

  private hoveredId: string | null = null;
  private hoverNeighbors: Set<string> = new Set();
  private hoveredIds: Set<string> = new Set();
  private hoveredOther: string | null = null;
  private pinnedId: string | null = null;
  private pinnedNeighbors: Set<string> = new Set();
  private pinnedEdge: string | null = null;
  private everBuilt = false;
  private graphReadyFired = false;
  /** Set once the camera has been framed to the normalized graph; reset on each (re)build. */
  private layoutCameraFitted = false;

  private _hoverTeamId: number | null = null;
  private _hoverMatchNodeIds: Set<string> | null = null;
  private _lastMatchEventId: number | null = null;
  private _preMatchGraph: UndirectedGraph | null = null;
  private _preMatchCamera: CameraState | null = null;

private refreshRaf: number | null = null;
   private clustersRaf: number | null = null;
   private metaballs: ReturnType<typeof createMetaballs> | null = null;
  private showMetaballs = false;
  private metaballsCanvas: HTMLCanvasElement | null = null;
  private grid: GridOverlay | null = null;
  private showGrid = true;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private hostSize = { w: 0, h: 0 };
  private resizeObserver: ResizeObserver | null = null;

  // Debug stats circular buffer (max ~15s at 20Hz = 300 points)
  private debugStats: LayoutTickStats[] = [];
  private readonly MAX_DEBUG_STATS = 300;

  private reduceState: StateGetters;

  constructor(private readonly opts: GraphControllerOpts) {
    this.positionStore = createPositionStore(opts.prevPos as Map<number, { x: number; y: number }>);
    this.positionStore.load();

    this.reduceState = {
      graph: () => this.graph,
      focusId: () => this.hoveredId ?? this.pinnedId,
      focusNeighbors: () => (this.hoveredId != null ? this.hoverNeighbors : this.pinnedNeighbors),
      hoveredId: () => this.hoveredId,
      hoveredIds: () => this.hoveredIds,
      hoveredOther: () => this.hoveredOther,
      pinnedId: () => this.pinnedId,
      pinnedNeighbors: () => this.pinnedNeighbors,
      pinnedEdge: () => this.pinnedEdge,
      hoverTeamId: () => this._hoverTeamId,
      hoverMatchNodeIds: () => this._hoverMatchNodeIds,
      edgePartnerId: this.edgePartnerId.bind(this),
      showEdges: () => opts.getShowEdges(),
      alphaMin: () => opts.getAlphaMin(),
      alphaMax: () => opts.getAlphaMax(),
    };

    this.setupResizeObserver();
    this.scheduleInitialBuild();

    this.opts.host.addEventListener("dblclick", this.handleHostDblClick);
  }

  // ---- Public API (called from Svelte template / controls) ----

  public fitToView(): void {
    fitAll(this.sigma, this.graph, { animate: true });
  }

  public zoomToTeam(teamId: number): void {
    zoomCameraToTeam(this.sigma, this.graph, teamId);
  }

  public hoverPartner(nodeId: number | null): void {
    if (!this.graph) return;
    this.hoveredOther = nodeId != null ? String(nodeId) : null;
    if (this.sigma) this.scheduleRefresh();
  }

  /** Highlight a single player node (driven by hovering a roster row in the match pane). */
  public hoverNode(playerId: number | null): void {
    if (!this.graph) return;
    this.hoveredIds = new Set();
    if (playerId != null && this.graph.hasNode(String(playerId))) {
      this.hoveredId = String(playerId);
      this.hoverNeighbors = new Set(this.graph.neighbors(String(playerId)));
    } else {
      this.hoveredId = null;
      this.hoverNeighbors = new Set();
    }
    if (this.sigma) this.scheduleRefresh();
  }

  /** Highlight both players at a shared jersey number (hovering the row's number in the match pane). */
  public hoverJersey(homeId: number | null, awayId: number | null): void {
    if (!this.graph) return;
    this.hoveredId = null;
    this.hoverNeighbors = new Set();
    const ids = new Set<string>();
    for (const pid of [homeId, awayId]) {
      if (pid != null && this.graph.hasNode(String(pid))) ids.add(String(pid));
    }
    this.hoveredIds = ids;
    if (this.sigma) this.scheduleRefresh();
  }

  /** Highlight all nodes of a team (driven by hovering a team name in the match pane). */
  public hoverTeam(teamId: number | null): void {
    this._hoverTeamId = teamId;
    if (this.sigma) {
      this.scheduleRefresh();
      this.scheduleClusters();
    }
  }

  /** Highlight nodes that participated in a match (driven by hovering a match row).
   *  Nodes not in the match are dimmed. Match hover takes precedence over
   *  other dimming - if active, only nodes in the match stay visible. */
  public hoverMatch(nodeIds: number[] | null): void {
    this._hoverMatchNodeIds = nodeIds != null ? new Set(nodeIds.map(String)) : null;
    if (this.sigma) this.scheduleRefresh();
  }

  public activateNode(nodeId: number | null): void {
    if (!this.graph) return;
    const id = nodeId != null ? String(nodeId) : null;
    this.pinnedId = id;
    this.pinnedNeighbors = new Set();
    this.pinnedEdge = null;
    if (id != null && this.graph.hasNode(id)) {
      this.pinnedNeighbors = new Set(this.graph.neighbors(id));
      const nodeKeys = [id, ...this.pinnedNeighbors];
      fitToNodes(this.sigma, this.graph, nodeKeys, { animate: true });
      this.spinRing?.start();
    }
    if (this.sigma) this.scheduleRefresh();
  }

  public activateEdge(edgeKey: string | null): void {
    if (!this.graph) return;
    this.pinnedEdge = edgeKey;
    this.pinnedId = null;
    this.pinnedNeighbors = new Set();
    if (edgeKey != null && this.graph.hasEdge(edgeKey)) {
      const [a, b] = this.graph.extremities(edgeKey);
      const sel = this.opts.getSelectedId();
      this.pinnedId = sel != null && (sel === Number(a) || sel === Number(b)) ? String(sel) : a;
      this.pinnedNeighbors = new Set([this.pinnedId === a ? b : a]);
      this.spinRing?.start();
    }
    if (this.sigma) this.scheduleRefresh();
  }

  public clearSelection(): void {
    this.pinnedId = null;
    this.pinnedNeighbors = new Set();
    this.pinnedEdge = null;
    this.spinRing?.stop();
    if (this.sigma) this.scheduleRefresh();
  }

  public setEdgeAlpha(lo: number, hi: number): void {
    if (!this.graph) return;
    this.graph.setAttribute("edgeAlphaMin", lo);
    this.graph.setAttribute("edgeAlphaMax", hi);
    if (this.sigma) this.sigma.refresh({ skipIndexation: true });
  }

  public setEdgeColorMode(mode: string): void {
    if (!this.graph) return;
    this.graph.setAttribute("edgeColorMode", mode);
    if (this.sigma) this.sigma.refresh({ skipIndexation: true });
  }

  public selectEdge(sourceId: number, targetId: number): void {
    if (!this.sigma || !this.graph) return;
    const source = String(sourceId);
    const target = String(targetId);
    const edge = this.graph.edge(source, target) ?? this.graph.edge(target, source);
    if (edge == null) return;
    this.opts.callbacks.onEdgeSelect(edgeSelection(this.graph, edge, undefined));
  }

  /** Recolour nodes in-place without rebuilding the graph. */
  public recolorNodes(): void {
    if (!this.graph || !this.sigma) return;
    const mode = this.opts.getNodeColor();
    const teams = this.opts.getTeams();
    this.graph.forEachNode((id, attrs) => {
      this.graph!.setNodeAttribute(
        id,
        "color",
        nodeFillColor(mode, {
          teams,
          teamId: attrs.team as number | null,
          jersey: attrs.jersey as number | null,
          isCoach: attrs.isCoach as boolean | undefined,
        }),
      );
    });
    this.sigma.refresh({ skipIndexation: true });
  }

  /** Refresh sigma render (for alpha/edge mode changes that reducers pick up). */
  public refresh(): void {
    this.sigma?.refresh({ skipIndexation: true });
  }

  /** Toggle metaballs visibility. */
  public setShowMetaballs(show: boolean): void {
    this.showMetaballs = show;
    this.updateMetaballs();
  }

  /** Toggle the reference grid overlay (drawn on a canvas behind sigma). */
  public setShowGrid(show: boolean): void {
    this.showGrid = show;
    this.grid?.draw();
  }

  private updateMetaballs(): void {
    if (!this.sigma || !this.metaballsCanvas) return;
    const shouldShow = this.showMetaballs && this.opts.getShowMetaballs();
    if (shouldShow && !this.metaballs) {
      try {
        this.metaballs = createMetaballs(this.metaballsCanvas, {
          getTeams: this.opts.getTeams,
          getNodeColor: this.opts.getNodeColor,
          getAlphaMin: this.opts.getAlphaMin,
          getAlphaMax: this.opts.getAlphaMax,
          getWinRates: this.opts.getWinRates,
          getShowEdges: this.opts.getShowEdges,
          getMatchEventId: this.opts.getMatchEventId,
        });
        this.sigma.on("afterRender", () => { if (this.graph) this.metaballs?.update(this.sigma!, this.graph!); });
      } catch (e) {
        this.metaballs = null;
      }
    } else if (!shouldShow && this.metaballs) {
      this.metaballs.kill();
      this.metaballs = null;
    }
  }

  public forceRebuild(): void {
    clearSubsetCache();
    const seed = this.graph
      ? new Map(Object.entries(circularSeed(this.graph)) as [string, { x: number; y: number }][])
      : null;
    this.rebuild(seed, false);
  }

  public refreshLayout(skipLayout = false): void {
    const matchEventId = this.opts.getMatchEventId();
    const entering = matchEventId != null && this._lastMatchEventId == null;
    const exiting = matchEventId == null && this._lastMatchEventId != null;
    this._lastMatchEventId = matchEventId;

    // Closing the match view restores the cached original (pre-match) graph
    // and camera exactly, without re-laying-out or re-fitting.
    if (exiting && this._preMatchGraph && this.sigma) {
      this.restorePreMatch();
      return;
    }
    if (entering) {
      this.capturePreMatch();
    }

    if (this.graph) {
      const seed = new Map<string, { x: number; y: number }>();
      for (const [id, pos] of this.positionStore.positions) {
        seed.set(String(id), pos);
      }
      this.graph.forEachNode((id, attrs) => {
        seed.set(id, { x: attrs.x, y: attrs.y });
      });
      this.rebuild(seed, exiting ? true : skipLayout);
    } else {
      // First build - graph doesn't exist yet
      this.build();
    }
  }

  private capturePreMatch(): void {
    if (!this.graph || !this.sigma) return;
    this._preMatchGraph = this.graph;
    this._preMatchCamera = this.sigma.getCamera().getState();
    this._hoverTeamId = null;
    this._hoverMatchNodeIds = null;
  }

  private restorePreMatch(): void {
    if (!this._preMatchGraph || !this.sigma) return;
    if (this.layoutManager) {
      this.layoutManager.dispose();
      this.layoutManager = null;
    }
    this.graph = this._preMatchGraph;
    this.sigma.setGraph(this.graph);
    this.resetInteraction();
    this._hoverTeamId = null;
    this._hoverMatchNodeIds = null;
    this.clusterLabels?.clear();
    this.updateClusters();
    this.bindLayoutListener();
    if (this._preMatchCamera) this.sigma.getCamera().setState(this._preMatchCamera);
    this.everBuilt = true;
    this.opts.callbacks.onLayoutState({
      running: false,
      first: false,
      nodes: this.graph.order,
      edges: this.graph.size,
    });
  }

  public dispose(): void {
    this.spinRing?.stop();
    this.cancelTimers();
    if (this.layoutManager) this.layoutManager.dispose();
    this.positionStore.persist(this.graph as UndirectedGraph);
    if (this.sigma) this.sigma.kill();
    if (this.grid) { this.grid.destroy(); this.grid = null; }
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.opts.host.removeEventListener("dblclick", this.handleHostDblClick);
if (this.refreshRaf != null) cancelAnimationFrame(this.refreshRaf);
     if (this.clustersRaf != null) cancelAnimationFrame(this.clustersRaf);
     if (this.metaballs) this.metaballs.kill();
  }

  // ---- Internal ----

  private scheduleInitialBuild(): void {
    if (this.hostSize.w > 0 && this.hostSize.h > 0) {
      this.build();
    }
    // ResizeObserver is already set up; it will trigger build when ready
  }

  /** Double-click anywhere on the graph recenters on the current view
   *  (the match's subset when a match is open, the full graph otherwise). */
  private handleHostDblClick = (ev: MouseEvent): void => {
    ev.preventDefault();
    fitAll(this.sigma, this.graph, { animate: true });
  };

  private setupResizeObserver(): void {
    const { host } = this.opts;
    if (!host) return;
    const updateSize = () => {
      this.hostSize = { w: host.offsetWidth, h: host.offsetHeight };
    };
    updateSize();
    this.resizeObserver = new ResizeObserver(() => {
      updateSize();
      this.handleResize();
    });
    this.resizeObserver.observe(host);
  }

  // Sigma in this version only sizes its canvas once at construction and never
  // re-syncs to the container, so on mobile (where the container's final size
	// stabilises after init) the canvas stays at the 300x150 default and the camera
  // frames the wrong region. Re-sync the canvas and re-frame when the size
  // actually changes.
  private handleResize(): void {
    if (!this.sigma || !this.graph) {
      if (this.containerReady()) this.build();
      return;
    }
    if (this.graph.order === 0) return;
    const prevW = this.sigma.getDimensions().width;
    this.sigma.resize();
    const newW = this.sigma.getDimensions().width;
    if (prevW === newW) return;
    this.grid?.draw();
    if (this.pinnedId != null) {
      const nodeKeys = [this.pinnedId, ...this.pinnedNeighbors];
      fitToNodes(this.sigma, this.graph, nodeKeys, { animate: true });
    } else {
      fitAll(this.sigma, this.graph, { animate: true });
    }
  }

  private containerReady(): boolean {
    const { host } = this.opts;
    return host != null && this.hostSize.w > 0 && this.hostSize.h > 0;
  }

  private scheduleRefresh(): void {
    if (this.refreshRaf != null) return;
    this.refreshRaf = requestAnimationFrame(() => {
      this.refreshRaf = null;
      if (this.sigma) this.sigma.refresh({ skipIndexation: true });
    });
  }

  private scheduleClusters(): void {
    if (this.clustersRaf != null) return;
    this.clustersRaf = requestAnimationFrame(() => {
      this.clustersRaf = null;
      this.updateClusters();
    });
  }

  private updateClusters(): void {
    if (this.clusterLabels && this.sigma && this.graph) {
      this.clusterLabels.update(this.sigma, this.graph, [this.hoveredId, this.pinnedId], this._hoverTeamId);
    }
  }

  private edgePartnerId(): string | null {
    if (this.pinnedEdge == null || this.pinnedId == null || !this.graph?.hasEdge(this.pinnedEdge)) return null;
    const [a, b] = this.graph.extremities(this.pinnedEdge);
    return a === this.pinnedId ? b : a;
  }

  private build(): void {
    if (!this.containerReady()) return;
    this.rebuild(null);
  }

  private rebuild(seedPositions: Map<string, { x: number; y: number }> | null, skipLayout = false): void {
    if (!this.containerReady()) return;
    const vn = this.opts.getViewNodes();
    const vl = this.opts.getViewLinks();
    if (!vn || vn.length === 0 || !this.opts.host) return;

    if (this.layoutManager) {
      this.layoutManager.dispose();
      this.layoutManager = null;
    }

    if (seedPositions !== null) {
      this.positionStore.replaceSeed(seedPositions);
    } else if (this.graph) {
      this.positionStore.persist(this.graph);
    }

    if (this.graphStepHandler && this.graph) {
      this.graph.removeListener("eachNodeAttributesUpdated", this.graphStepHandler);
    }
    this.graphStepHandler = null;

    this.graph = buildGraph({
      nodes: vn,
      links: vl,
      prevPos: this.positionStore.positions,
      teams: this.opts.getTeams(),
      nodeColorMode: this.opts.getNodeColor(),
      edgeColorMode: this.opts.getEdgeColor(),
      alphaMin: this.opts.getAlphaMin(),
      alphaMax: this.opts.getAlphaMax(),
      winRates: this.opts.getWinRates(),
    });

    if (!this.sigma) {
      this.sigma = this.createSigma();
    } else {
      this.sigma.setGraph(this.graph);
    }
	// Keep sigma's canvas matched to the (possibly just-resized) container so
    // the camera frames the real viewport rather than a stale size.
    this.sigma.resize();

    this.bindLayoutListener();
    this.resetInteraction();
    this.clusterLabels?.clear();
    this.updateClusters();

    const matchEventId = this.opts.getMatchEventId();
    if (matchEventId != null) {
      fitAll(this.sigma, this.graph, { animate: true });
    }

    try {
      this.restartLayout(skipLayout);
    } catch (e) {
      // layout errors are non-fatal; the graph still renders
    }
    this.grid?.draw();
  }

private createSigma(): Sigma {
    const nodeReducer = createNodeReducer(this.reduceState);
    const edgeReducer = createEdgeReducer(this.reduceState);

    const s = new Sigma(this.graph!, this.opts.host, createSigmaOptions({ nodeReducer, edgeReducer }));

    s.refresh();

    // Reference grid (lines + coordinate labels), drawn on its own canvas
    // behind sigma's render canvas. Shared with the test page via grid.ts.
    this.grid = createGridOverlay(this.opts.host, {
      getSigma: () => this.sigma,
      getGraph: () => this.graph,
      getShow: () => this.showGrid,
    });
    s.getCamera().addListener("updated", () => this.grid?.draw());

    // Check actual node positions
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    this.graph!.forEachNode((_id, attrs) => {
      if (attrs.x < minX) minX = attrs.x;
      if (attrs.x > maxX) maxX = attrs.x;
      if (attrs.y < minY) minY = attrs.y;
      if (attrs.y > maxY) maxY = attrs.y;
    });

    // Force fit to all nodes - manually set camera
    const { width, height } = s.getDimensions();
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const spreadX = maxX - minX;
    const spreadY = maxY - minY;

    // Use fitAll from @sigma/utils to properly frame the graph
    fitAll(s, this.graph!);

    // If fitAll didn't work (camera still at default), manually set camera
    const cameraState = s.getCamera().getState();
    if (cameraState.x === 0.5 && cameraState.y === 0.5 && cameraState.ratio < 10) {
      const maxSpread = Math.max(spreadX, spreadY);
      const ratio2 = maxSpread / Math.min(width, height) * 1.2;
      s.getCamera().setState({ x: centerX, y: centerY, ratio: ratio2 });
    }

    // Force render
    s.refresh();

    this.clusterLabels = createClusterLabels(
      s.createLayer("clusters", "div"),
      { teams: this.opts.getTeams() },
    );
    this.activeEdgeOverlay = createActiveEdgeOverlay(
      this.opts.host,
      s.createLayer("activeEdge", "canvas"),
      {
        getSigma: () => this.sigma,
        getGraph: () => this.graph,
        state: this.reduceState,
      },
    );
    this.spinRing = createSpinRing(
      this.opts.host,
      s.createLayer("spinRing", "canvas"),
      {
        getSigma: () => this.sigma,
        getGraph: () => this.graph,
        state: this.reduceState,
      },
    );
    this.metaballsCanvas = s.createLayer("metaballs", "canvas") as HTMLCanvasElement;
    this.updateMetaballs();
     
     s.on("clickNode", ({ node }: { node: string }) => {
      const clickedId = Number(node);
      const selectedId = this.opts.getSelectedId();
      if (selectedId != null && clickedId === selectedId) {
        // Clicking the already-active (primary) node: if a secondary node is
        // highlighted, clear just that secondary instead of dropping the whole
        // selection and returning to the main graph view.
        const secondaryId = this.opts.getSecondaryId();
        if (secondaryId != null) {
          this.opts.callbacks.onSelectSecondary(null);
          return;
        }
        // Otherwise deselect the primary node and recenter on the whole graph.
        this.opts.callbacks.onSelect(null);
        fitAll(this.sigma, this.graph, { animate: true });
        return;
      }
      if (selectedId != null && this.graph) {
        const source = String(selectedId);
        const target = String(clickedId);
        const edge = this.graph.edge(source, target) ?? this.graph.edge(target, source);
        if (edge != null) {
          if (this.pinnedEdge === edge) {
            this.opts.callbacks.onSelect(clickedId);
          } else {
            const s_ext = this.graph.extremities(edge);
            const attrs = this.graph.getEdgeAttributes(edge);
            this.opts.callbacks.onEdgeSelect({
              key: edge,
              a: this.graph.getNodeAttribute(s_ext[0], "name") as string,
              b: this.graph.getNodeAttribute(s_ext[1], "name") as string,
              source: s_ext[0],
              target: s_ext[1],
              team: this.graph.getNodeAttribute(s_ext[0], "team") as number | null,
              w: attrs.w as number,
              dates: (attrs.dates as string[]) || [],
            });
          }
          return;
        }
      }
      this.opts.callbacks.onSelect(clickedId);
    });

    s.on("clickStage", () => this.opts.callbacks.onStageClick());

    s.on("enterNode", ({ node }: { node: string }) => {
      this.opts.host!.style.cursor = "pointer";
      const nodeTeam = this.graph!.getNodeAttribute(node, "team") as number | null | undefined;
      this.opts.callbacks.onNodeTeamHover(nodeTeam != null ? nodeTeam : null);
      // Always report the hovered player so the match pane can highlight
      // the corresponding roster row (not just the team name).
      this.opts.callbacks.onNodeHover(node);
      if (this.pinnedId != null) {
        this.hoveredOther = node;
        const edge = this.graph!.edge(this.pinnedId, node);
        if (edge != null) {
          const pa = this.graph!.getNodeAttributes(this.pinnedId);
          const pb = this.graph!.getNodeAttributes(node);
          const mid = this.sigma!.graphToViewport({ x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 });
          const w = this.graph!.getEdgeAttribute(edge, "w");
          this.opts.callbacks.onTooltip({
            x: mid.x,
            y: mid.y,
            visible: true,
            text: `${w} shared games`,
          });
        }
      } else {
        this.hoveredId = node;
        this.hoverNeighbors = new Set(this.graph!.neighbors(node));
      }
      this.scheduleRefresh();
    });

    s.on("leaveNode", () => {
      this.opts.host!.style.cursor = "default";
      this.hoveredId = null;
      this.hoveredOther = null;
      this.opts.callbacks.onNodeHover(null);
      this.opts.callbacks.onNodeTeamHover(null);
      this.hoverNeighbors = new Set();
      this.opts.callbacks.onTooltip(null);
      this.scheduleRefresh();
    });

    s.on("afterRender", () => {
      this.scheduleClusters();
      this.activeEdgeOverlay?.draw();
      if (!this.graphReadyFired) {
        this.graphReadyFired = true;
        this.opts.callbacks.onGraphReady?.();
      }
    });

    return s;
  }

  private bindLayoutListener(): void {
    if (this.graphStepHandler && this.graph) {
      this.graph.removeListener("eachNodeAttributesUpdated", this.graphStepHandler);
    }
    this.graphStepHandler = () => this.positionStore.capture(this.graph!);
    this.graph?.on("eachNodeAttributesUpdated", this.graphStepHandler);
  }

  private resetInteraction(): void {
    this.hoveredId = null;
    this.hoverNeighbors = new Set();
    this.hoveredIds = new Set();
    this.hoveredOther = null;
    this.pinnedId = null;
    this.pinnedNeighbors = new Set();
    this.pinnedEdge = null;
    this._hoverMatchNodeIds = null;
    this.spinRing?.stop();
  }

  private restartLayout(skipLayout = false): void {
    if (this.layoutManager) this.layoutManager.dispose();
    this.debugStats = []; // Reset debug stats on new layout
    this.layoutCameraFitted = false;
    const hasNodes = this.graph!.order > 0;
    const first = !this.everBuilt;
    const layoutMatchEvent = this.opts.getMatchEventId();

    if (hasNodes) {
      this.everBuilt = true;
    }

    if (skipLayout || !hasNodes) {
      if (hasNodes) {
        this.opts.callbacks.onLayoutState({ running: false, first, nodes: this.graph!.order, edges: this.graph!.size });
        normalizePositions(this.graph!);
        this.positionStore.persist(this.graph!);
      }
      if (layoutMatchEvent != null) {
        fitAll(this.sigma, this.graph, { animate: true });
      } else if (this.pinnedId == null) {
        fitAll(this.sigma, this.graph);
      }
      return;
    }

    this.opts.callbacks.onLayoutState({ running: true, first, nodes: this.graph!.order, edges: this.graph!.size });

    try {
      this.layoutManager = createLayoutManager(this.graph!, {
        onNodeMove: () => this.positionStore.persist(this.graph!),
        onNodeMoved: () => {
          // Fired every layout tick after coordinates are normalized to [0, 1].
          // Frame the camera once so the bounded graph is visible.
          if (!this.layoutCameraFitted && this.sigma) {
            fitAll(this.sigma, this.graph);
            this.layoutCameraFitted = true;
          }
        },
		onLayoutTick: (stats) => this.recordDebugStat(stats),
      });
      this.layoutManager.start();
    } catch (e) {
      this.opts.callbacks.onLayoutState({ running: false, first, nodes: this.graph!.order, edges: this.graph!.size });
    }
  }

  private recordDebugStat(stats: LayoutTickStats): void {
    this.debugStats.push(stats);
    if (this.debugStats.length > this.MAX_DEBUG_STATS) {
      this.debugStats.shift();
    }
  }

  /** Returns a copy of the debug stats buffer for external consumption. */
  public getDebugStats(): LayoutTickStats[] {
    return [...this.debugStats];
  }

  private cancelTimers(): void {
    if (this.rebuildTimer != null) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
  }
}
