// GraphController: imperative sigma/graph lifecycle.
// Extracted from Graph.svelte so the component stays declarative.

import Sigma from "sigma";
import { UndirectedGraph } from "graphology";
import { sigmaOptions } from "./graph/programs.ts";
import { createNodeReducer, createEdgeReducer, type StateGetters } from "./graph/reducers.ts";
import { createPositionStore, type PositionStore } from "./graph/positions.ts";
import { createLayoutManager, circularSeed } from "./graph/layout.ts";
import { fitAll, fitToNodes, zoomToTeam as zoomCameraToTeam } from "./graph/camera.ts";
import { createClusterLabels } from "./graph/cluster-labels.ts";
import { createActiveEdgeOverlay } from "./graph/active-edge.ts";
import { dedupeNodeHitTest } from "./graph/hit-testing.ts";
import { edgeSelection } from "./graph/edge-detail.ts";
import { buildGraph, type _BuildGraphOpts } from "./graph/build-graph.ts";
import { clearSubsetCache } from "./lib.ts";
import { nodeFillColor } from "./graph/colors.ts";
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
  getMatchEventId: () => number | null;
  getViewNodes: () => Player[];
  getViewLinks: () => Link[];
  getSelectedId: () => number | null;
}

export class GraphController {
  private sigma: Sigma | null = null;
  private graph: UndirectedGraph | null = null;
  private layoutManager: { start: () => void; dispose: () => void } | null = null;
  private clusterLabels: ReturnType<typeof createClusterLabels> | null = null;
  private activeEdgeOverlay: ReturnType<typeof createActiveEdgeOverlay> | null = null;
  private positionStore: PositionStore;
  private graphStepHandler: (() => void) | null = null;

  private hoveredId: string | null = null;
  private hoverNeighbors: Set<string> = new Set();
  private hoveredOther: string | null = null;
  private pinnedId: string | null = null;
  private pinnedNeighbors: Set<string> = new Set();
  private pinnedEdge: string | null = null;
  private everBuilt = false;

  private _hoverTeamId: number | null = null;
  private _lastMatchEventId: number | null = null;
  private _preMatchGraph: UndirectedGraph | null = null;
  private _preMatchCamera: CameraState | null = null;

  private refreshRaf: number | null = null;
  private clustersRaf: number | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private hostSize = { w: 0, h: 0 };
  private resizeObserver: ResizeObserver | null = null;

  private reduceState: StateGetters;

  constructor(private readonly opts: GraphControllerOpts) {
    this.positionStore = createPositionStore(opts.prevPos as Map<number, { x: number; y: number }>);
    this.positionStore.load();

    this.reduceState = {
      graph: () => this.graph,
      focusId: () => this.hoveredId ?? this.pinnedId,
      focusNeighbors: () => (this.hoveredId != null ? this.hoverNeighbors : this.pinnedNeighbors),
      hoveredId: () => this.hoveredId,
      hoveredOther: () => this.hoveredOther,
      pinnedId: () => this.pinnedId,
      pinnedNeighbors: () => this.pinnedNeighbors,
      pinnedEdge: () => this.pinnedEdge,
      hoverTeamId: () => this._hoverTeamId,
      edgePartnerId: this.edgePartnerId.bind(this),
      showEdges: () => opts.getShowEdges(),
      alphaMin: () => opts.getAlphaMin(),
      alphaMax: () => opts.getAlphaMax(),
    };

    this.setupResizeObserver();
    this.scheduleInitialBuild();
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
    if (playerId != null && this.graph.hasNode(String(playerId))) {
      this.hoveredId = String(playerId);
      this.hoverNeighbors = new Set(this.graph.neighbors(String(playerId)));
    } else {
      this.hoveredId = null;
      this.hoverNeighbors = new Set();
    }
    if (this.sigma) this.scheduleRefresh();
  }

  /** Highlight all nodes of a team (driven by hovering a team name in the match pane). */
  public hoverTeam(teamId: number | null): void {
    this._hoverTeamId = teamId;
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
      this.pinnedId = a;
      this.pinnedNeighbors = new Set([b]);
    }
    if (this.sigma) this.scheduleRefresh();
  }

  public clearSelection(): void {
    this.pinnedId = null;
    this.pinnedNeighbors = new Set();
    this.pinnedEdge = null;
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
        }),
      );
    });
    this.sigma.refresh({ skipIndexation: true });
  }

  /** Refresh sigma render (for alpha/edge mode changes that reducers pick up). */
  public refresh(): void {
    this.sigma?.refresh({ skipIndexation: true });
  }

  public forceRebuild(): void {
    clearSubsetCache();
    const seed = this.graph
      ? new Map(Object.entries(circularSeed(this.graph)) as [string, { x: number; y: number }][])
      : null;
    this.rebuild(seed, false);
  }

  public refreshLayout(): void {
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
      this.rebuild(seed, true);
    }
  }

  private capturePreMatch(): void {
    if (!this.graph || !this.sigma) return;
    this._preMatchGraph = this.graph;
    this._preMatchCamera = this.sigma.getCamera().getState();
    this._hoverTeamId = null;
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
    this.cancelTimers();
    if (this.layoutManager) this.layoutManager.dispose();
    this.positionStore.persist(this.graph as UndirectedGraph);
    if (this.sigma) this.sigma.kill();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.refreshRaf != null) cancelAnimationFrame(this.refreshRaf);
    if (this.clustersRaf != null) cancelAnimationFrame(this.clustersRaf);
  }

  // ---- Internal ----

  private scheduleInitialBuild(): void {
    if (this.hostSize.w > 0 && this.hostSize.h > 0) {
      this.build();
    }
    // ResizeObserver is already set up; it will trigger build when ready
  }

  private setupResizeObserver(): void {
    const { host } = this.opts;
    if (!host) return;
    const updateSize = () => {
      this.hostSize = { w: host.offsetWidth, h: host.offsetHeight };
    };
    updateSize();
    this.resizeObserver = new ResizeObserver(() => {
      updateSize();
      if (this.containerReady() && this.graph) {
        // Container grew; trigger a rebuild if one was pending
      }
    });
    this.resizeObserver.observe(host);
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
      this.clusterLabels.update(this.sigma, this.graph, [this.hoveredId, this.pinnedId]);
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
    if (!vn || !this.opts.host) return;

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

    this.bindLayoutListener();
    this.resetInteraction();
    this.clusterLabels?.clear();
    this.updateClusters();

    const matchEventId = this.opts.getMatchEventId();
    if (matchEventId != null) {
      fitAll(this.sigma, this.graph, { animate: false });
    }

    this.restartLayout(skipLayout);
  }

  private createSigma(): Sigma {
    const nodeReducer = createNodeReducer(this.reduceState);
    const edgeReducer = createEdgeReducer(this.reduceState);

    const s = new Sigma(this.graph!, this.opts.host, sigmaOptions({ nodeReducer, edgeReducer }));
    dedupeNodeHitTest(s);

    this.clusterLabels = createClusterLabels(
      s.createLayer("clusters", "div"),
      { teams: this.opts.getTeams() },
    );
    this.activeEdgeOverlay = createActiveEdgeOverlay(
      this.opts.host,
      s.createLayer("activeEdge", "canvas", { beforeLayer: "labels" }),
      {
        getSigma: () => this.sigma,
        getGraph: () => this.graph,
        state: this.reduceState,
      },
    );

    s.on("clickNode", ({ node }: { node: string }) => {
      const clickedId = Number(node);
      const selectedId = this.opts.getSelectedId();
      if (selectedId != null && clickedId === selectedId) {
        this.activateNode(clickedId);
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
    s.on("doubleClickStage", ({ preventSigmaDefault }: { preventSigmaDefault: () => void }) => {
      preventSigmaDefault();
      fitAll(this.sigma, this.graph, { animate: true });
    });

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

    s.on("afterRender", () => this.scheduleClusters());
    s.on("afterRender", () => this.activeEdgeOverlay?.draw());

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
    this.hoveredOther = null;
    this.pinnedId = null;
    this.pinnedNeighbors = new Set();
    this.pinnedEdge = null;
  }

  private restartLayout(skipLayout = false): void {
    if (this.layoutManager) this.layoutManager.dispose();
    const hasNodes = this.graph!.order > 0;
    const first = !this.everBuilt;
    const layoutMatchEvent = this.opts.getMatchEventId();

    if (hasNodes) {
      this.everBuilt = true;
    }

    if (skipLayout || !hasNodes) {
      if (hasNodes) {
        this.opts.callbacks.onLayoutState({ running: false, first, nodes: this.graph!.order, edges: this.graph!.size });
      }
      if (layoutMatchEvent != null) {
        fitAll(this.sigma, this.graph, { animate: false });
      } else if (this.pinnedId == null) {
        fitAll(this.sigma, this.graph);
      }
      return;
    }

    this.opts.callbacks.onLayoutState({ running: true, first, nodes: this.graph!.order, edges: this.graph!.size });

    this.layoutManager = createLayoutManager(this.graph!, {
      onNodeMove: () => this.positionStore.persist(this.graph!),
      onSettled: () => {
        if (hasNodes) this.opts.callbacks.onLayoutState({ running: false, first, nodes: this.graph!.order, edges: this.graph!.size });
        if (layoutMatchEvent != null) {
          fitAll(this.sigma, this.graph, { animate: false });
        } else if (this.pinnedId == null) {
          fitAll(this.sigma, this.graph);
        }
      },
    });
    this.layoutManager.start();
  }

  private cancelTimers(): void {
    if (this.rebuildTimer != null) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
  }
}
