<script>
	import { onDestroy } from "svelte";
	import Sigma from "sigma";
	import { buildGraph } from "./graph/build-graph.js";
	import { nodeFillColor } from "./graph/colors.js";
	import { createNodeReducer, createEdgeReducer } from "./graph/reducers.js";
	import { createPositionStore } from "./graph/positions.js";
	import { createLayoutManager, circularSeed } from "./graph/layout.js";
	import { fitAll, fitToNodes, zoomToTeam as zoomCameraToTeam } from "./graph/camera.js";
	import { createClusterLabels } from "./graph/cluster-labels.js";
	import { createActiveEdgeOverlay } from "./graph/active-edge.js";
	import { sigmaOptions } from "./graph/programs.js";
	import { dedupeNodeHitTest } from "./graph/hit-testing.js";
	import { edgeSelection } from "./graph/edge-detail.js";

	let {
		viewNodes,
		viewLinks,
		teams,
		prevPos = new Map(),
		selectedId,
		selectedEdge,
		onSelect,
		onEdgeSelect = () => {},
		// Click on empty canvas, outside any node/edge. App decides whether that
		// just clears the selection or also closes an open match view.
		onStageClick = () => {},
		// Canvas hover reporter: called with the hovered node id when a primary
		// node is pinned (App mirrors it onto the matching teammate row), null
		// when the pointer leaves the canvas node.
		onNodeHover = () => {},
		// Load-state reporter: called with { running, first } when a layout
		// starts, and { running:false, first } once it settles. App uses it to
		// show/clear a loading overlay; "first" marks the initial build so
		// filter-driven rebuilds don't re-trigger the full indicator.
		onLayoutState = () => {},
		edgeColor = "winrate",
		alphaMin = 0.05,
		alphaMax = 0.6,
		winRates = new Map(),
		showEdges = true,
		nodeColor = "jersey",
		// eventId of the focused match, or null. When it changes the graph is
		// rebuilt to match participants only; that drastic reduction should
		// refit the camera to the (still selected) node and its new neighbours.
		matchEventId = null,
	} = $props();

	// The position store wraps the same Map App passes through prevPos, so
	// iterated/fltered views read stable player coordinates no matter when the
	// graph renders. Re-create the binding if App ever swaps the map.
	let store;
	$effect(() => {
		store = createPositionStore(prevPos);
		store.load();
	});

	let host;
	let sigma = null;
	let graph = null;
	let layoutManager = null;
	let clusterLabels = null;
	let activeEdgeOverlay = null;

	let hoveredId = null;
	let hoverNeighbors = new Set();
	let hoveredOther = null;
	let pinnedId = null;
	let pinnedNeighbors = new Set();
	let pinnedEdge = null;
	// Bumped every graph rebuild so selection state (edge key, neighbor set)
	// can be re-synced against the new graph even when selectedId is unchanged.
	let graphSeq = $state(0);
	let tip = $state({ x: 0, y: 0, visible: false, text: "" });
	let fittedForSel = null;
	// Whether a non-empty graph has been laid out yet; gates the "first" flag
	// in the layout-state reports (an initial render with zero nodes while the
	// data fetch is still in flight must not count as the first layout).
	let everBuilt = false;

	// The focus rules read this snapshot of interaction state through
	// functions so the reducers always see the current values without the
	// component re-creating them on every render.
	const focusId = () => hoveredId ?? pinnedId;
	const focusNeighbors = () => (hoveredId != null ? hoverNeighbors : pinnedNeighbors);
	const edgePartnerId = () => {
		if (pinnedEdge == null || pinnedId == null || !graph.hasEdge(pinnedEdge)) return null;
		const [a, b] = graph.extremities(pinnedEdge);
		return a === pinnedId ? b : a;
	};
	const reduceState = {
		graph: () => graph,
		focusId,
		focusNeighbors,
		hoveredId: () => hoveredId,
		hoveredOther: () => hoveredOther,
		pinnedId: () => pinnedId,
		pinnedNeighbors: () => pinnedNeighbors,
		pinnedEdge: () => pinnedEdge,
		edgePartnerId,
		showEdges: () => showEdges,
		alphaMin: () => alphaMin,
		alphaMax: () => alphaMax,
	};
	const nodeReducer = createNodeReducer(reduceState);
	const edgeReducer = createEdgeReducer(reduceState);

	// Coalesce bursts of hover events (a mouse crossing many nodes) into a
	// single refresh per animation frame instead of one full re-render per
	// event. This is the main source of main-thread stalls while moving the
	// mouse over the graph.
	let refreshRaf = null;
	function scheduleRefresh() {
		if (refreshRaf != null) return;
		refreshRaf = requestAnimationFrame(() => {
			refreshRaf = null;
			if (sigma) sigma.refresh({ skipIndexation: true });
		});
	}

	let clustersRaf = null;
	function scheduleClusters() {
		if (clustersRaf != null) return;
		clustersRaf = requestAnimationFrame(() => {
			clustersRaf = null;
			updateClusters();
		});
	}

	function updateClusters() {
		if (clusterLabels && sigma && graph) {
			clusterLabels.update(sigma, graph, [hoveredId, pinnedId]);
		}
	}

	// ---- sigma setup ----
	function createSigma() {
		const s = new Sigma(graph, host, sigmaOptions({ nodeReducer, edgeReducer }));
		window.__sigma = s;
		window.__graph = graph;

		dedupeNodeHitTest(s);

		clusterLabels = createClusterLabels(s.createLayer("clusters", "div"), { teams });
		activeEdgeOverlay = createActiveEdgeOverlay(
			host,
			s.createLayer("activeEdge", "canvas", { beforeLayer: "labels" }),
			{ getSigma: () => sigma, getGraph: () => graph, state: reduceState },
		);

		s.on("clickNode", ({ node }) => {
			const clickedId = Number(node);
			if (selectedId != null) {
				if (clickedId === Number(selectedId)) {
					onSelect(null);
					return;
				}
				const edge =
					graph.edge(String(selectedId), String(clickedId)) ??
					graph.edge(String(clickedId), String(selectedId));
				if (edge != null) {
					if (selectedEdge?.key === edge) {
						onSelect(clickedId);
					} else {
						const [a] = graph.extremities(edge);
						onEdgeSelect(edgeSelection(graph, edge, graph.getNodeAttribute(a, "team")));
					}
					return;
				}
			}
			onSelect(clickedId);
		});
		s.on("clickStage", () => onStageClick());
		s.on("doubleClickStage", ({ preventSigmaDefault }) => {
			preventSigmaDefault();
			fitAll(sigma, graph);
		});
		s.on("enterNode", ({ node }) => {
			host.style.cursor = "pointer";
			if (pinnedId != null) {
				hoveredOther = node;
				onNodeHover(node);
				const edge = graph.edge(pinnedId, node);
				if (edge != null) {
					const pa = graph.getNodeAttributes(pinnedId);
					const pb = graph.getNodeAttributes(node);
					const mid = sigma.graphToViewport({ x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 });
					tip = {
						x: mid.x,
						y: mid.y,
						visible: true,
						text: `${graph.getEdgeAttribute(edge, "w")} shared games`,
					};
				}
			} else {
				hoveredId = node;
				hoverNeighbors = new Set(graph.neighbors(node));
			}
			scheduleRefresh();
			window.__hover = { hoveredId, hoveredOther, neighbors: hoverNeighbors.size };
		});
		s.on("leaveNode", () => {
			host.style.cursor = "default";
			hoveredId = null;
			hoveredOther = null;
			onNodeHover(null);
			hoverNeighbors = new Set();
			tip = { x: 0, y: 0, visible: false, text: "" };
			scheduleRefresh();
			window.__hover = { hoveredId: null, neighbors: 0 };
		});
		s.on("afterRender", scheduleClusters);
		s.on("afterRender", () => activeEdgeOverlay?.draw());

		return s;
	}

	// ---- layout ----
	function restartLayout() {
		if (layoutManager) layoutManager.dispose();
		const hasNodes = graph.order > 0;
		const first = !everBuilt;
		// Capture the focus at layout start: when this layout belongs to a
		// match reduction, its settle recenters the whole reduced graph.
		const layoutMatchEvent = matchEventId;
		if (hasNodes) {
			everBuilt = true;
			onLayoutState({ running: true, first, nodes: graph.order, edges: graph.size });
		}
		layoutManager = createLayoutManager({
			graph,
			onNodeMove: () => store.persist(graph),
			onSettled: () => {
				if (hasNodes) onLayoutState({ running: false, first, nodes: graph.order, edges: graph.size });
				if (layoutMatchEvent != null) {
					// A match focus just rebuilt the graph to its participants.
					// Snap the camera straight to that reduced view instead of
					// animating from the previously selected player's zoom, so
					// the transition reads as "fit the match" not "zoom out".
					fitAll(sigma, graph, { animate: false });
				} else if (pinnedId == null) {
					// Auto-fit only when nothing is selected: a selection
					// already fitted the camera to that node, and snapping to
					// the whole graph here (seconds after the user picked a
					// node) would yank the zoom back out.
					fitAll(sigma, graph);
				}
			},
		});
		layoutManager.start();
	}

	// ---- lifecycle ----
	let graphStepHandler = null;
	function bindLayoutListener() {
		if (graphStepHandler) graph.removeListener("eachNodeAttributesUpdated", graphStepHandler);
		graphStepHandler = () => store.capture(graph);
		graph.on("eachNodeAttributesUpdated", graphStepHandler);
	}

	function resetInteraction() {
		hoveredId = null;
		hoverNeighbors = new Set();
		hoveredOther = null;
		pinnedId = null;
		pinnedNeighbors = new Set();
		pinnedEdge = null;
		tip = { x: 0, y: 0, visible: false, text: "" };
	}

	function rebuild(vn, vl, seedPositions = null) {
		if (layoutManager) {
			layoutManager.dispose();
			layoutManager = null;
		}
		if (seedPositions !== null) {
			// A seed was supplied (e.g. the circular layout from "Rebuild
			// Layout"): apply it as initial positions, then let FA2 settle the
			// layout from there. buildGraph reads the seed via the position
			// store, so restartLayout() starts from the ring instead of a
			// random scatter.
			store.replaceSeed(seedPositions);
		} else {
			store.persist(graph);
		}
		if (graphStepHandler) graph.removeListener("eachNodeAttributesUpdated", graphStepHandler);
		graphStepHandler = null;
		graph = buildGraph({
			nodes: vn,
			links: vl,
			prevPos: store.positions,
			teams,
			nodeColorMode: nodeColor,
			edgeColorMode: edgeColor,
			alphaMin,
			alphaMax,
			winRates,
		});
		if (!containerReady()) {
			// Container has no dimensions yet (hidden/minimized tab, HMR
			// remount, initial layout race). Constructing sigma now would
			// throw; retry once the host has real size.
			retryWhenContainerReady(vn, vl);
			return;
		}
		if (!sigma) {
			sigma = createSigma();
		} else {
			sigma.setGraph(graph);
		}
		bindLayoutListener();
		resetInteraction();
		clusterLabels?.clear();
		// A match focus should frame the reduced view immediately: dropping the
		// previous selection's zoom here (rather than letting it survive until
		// the layout settles) is what makes "click a match" read as a cut to
		// the match view instead of a zoom-out from the player.
		if (matchEventId != null) fitAll(sigma, graph, { animate: false });
		// Force the selection effect to re-run against the freshly keyed graph
		// so the pinned edge/neighbours are re-resolved by endpoint.
		graphSeq++;
		restartLayout();
	}

	// ---- rebuild scheduling ----
	let rebuildTimer = null;
	let pendingRebuild = null;
	let hostSize = { w: 0, h: 0 };
	function containerReady() {
		return host != null && hostSize.w > 0 && hostSize.h > 0;
	}
	function retryWhenContainerReady(vn, vl) {
		pendingRebuild = [vn, vl];
	}
	function flushPendingRebuild() {
		if (!pendingRebuild) return;
		const [vn, vl] = pendingRebuild;
		pendingRebuild = null;
		scheduleRebuild(vn, vl);
	}
	function scheduleRebuild(vn, vl) {
		if (rebuildTimer != null) clearTimeout(rebuildTimer);
		if (graph == null) {
			// First build happens synchronously; later ones debounce so that
			// rapid filter changes collapse into a single graph rebuild.
			rebuild(vn, vl);
			return;
		}
		rebuildTimer = setTimeout(() => {
			rebuildTimer = null;
			rebuild(vn, vl);
		}, 150);
	}

	// Container dimensions are tracked via ResizeObserver instead of polling
	// offsetWidth/offsetHeight in a rAF loop, which forced synchronous layout
	// on every frame until the host had a size.
	$effect(() => {
		const el = host;
		if (!el) return;
		const updateSize = () => {
			hostSize = { w: el.offsetWidth, h: el.offsetHeight };
		};
		updateSize();
		const observer = new ResizeObserver(() => {
			updateSize();
			if (containerReady()) flushPendingRebuild();
		});
		observer.observe(el);
		return () => observer.disconnect();
	});

	$effect(() => {
		const vn = viewNodes;
		const vl = viewLinks;
		if (!vn || !host) return;
		scheduleRebuild(vn, vl);
	});

	// Recolour nodes in place when the node colour mode changes (jersey vs
	// team), without rebuilding the graph or disturbing the layout.
	$effect(() => {
		const mode = nodeColor;
		if (!graph || !sigma) return;
		graph.forEachNode((id, attrs) => {
			graph.setNodeAttribute(
				id,
				"color",
				nodeFillColor(mode, { teams, teamId: attrs.team, jersey: attrs.jersey }),
			);
		});
		sigma.refresh({ skipIndexation: true });
	});

	// Edge colours (incl. alpha) are computed per-frame in edgeReducer; the
	// reducer reads the live values from graph attributes, so write them here
	// whenever the props change and refresh. This also covers paths that
	// bypass the UI handlers (keyboard binds, Reset).
	$effect(() => {
		if (!graph) return;
		graph.setAttribute("edgeColorMode", edgeColor);
		graph.setAttribute("edgeAlphaMin", alphaMin);
		graph.setAttribute("edgeAlphaMax", alphaMax);
		if (sigma) sigma.refresh({ skipIndexation: true });
	});

	// Re-run edgeReducer whenever the edges toggle changes so the hidden flags
	// update without a full graph rebuild. The same refresh path the selection
	// effect uses to re-stamp edge visibility.
	$effect(() => {
		showEdges;
		if (sigma && graph) sigma.refresh({ skipIndexation: true });
	});

	$effect(() => {
		const sel = selectedId;
		graphSeq; // re-run after every rebuild so pin state tracks the new graph
		if (sigma && graph) {
			if (sel != null && graph.hasNode(String(sel))) {
				pinnedId = String(sel);
				pinnedNeighbors = new Set(graph.neighbors(String(sel)));
				if (sel !== fittedForSel) {
					// A node just became active (e.g. graph click, search pick):
					// show it and its neighbours. Skip when sel is unchanged so
					// filter-driven graph rebuilds don't yank the camera.
					fittedForSel = sel;
					fitToNodes(sigma, graph, [String(sel), ...pinnedNeighbors]);
				}
			} else {
				pinnedId = null;
				pinnedNeighbors = new Set();
				fittedForSel = null;
				if (matchEventId != null) {
					// Deselecting while in match view (closing the player pane,
					// clicking empty canvas, Escape): pick the camera back up to
					// frame the whole participant graph instead of drifting off
					// the previously focused node. Animate — it reverses the
					// selection zoom-in, unlike match entry which snaps.
					fitAll(sigma, graph, { animate: true });
				}
			}
			// Re-key the pinned edge after a rebuild: buildGraph re-stamps
			// edges with fresh sequential keys, so the selected key is stale.
			// Resolve by endpoints, falling back to null when either node or
			// the connecting edge vanished from the reduced view.
			let newKey = null;
			if (selectedEdge && graph.hasNode(selectedEdge.source) && graph.hasNode(selectedEdge.target)) {
				newKey =
					graph.edge(selectedEdge.source, selectedEdge.target) ??
					graph.edge(selectedEdge.target, selectedEdge.source) ??
					null;
			}
			pinnedEdge = newKey;
			sigma.refresh({ skipIndexation: true });
		}
		window.__sel = { selectedId, hasSigma: !!sigma };
	});

	onDestroy(() => {
		if (refreshRaf != null) cancelAnimationFrame(refreshRaf);
		if (clustersRaf != null) cancelAnimationFrame(clustersRaf);
		if (rebuildTimer != null) clearTimeout(rebuildTimer);
		if (layoutManager) layoutManager.dispose();
		store.persist(graph);
		if (sigma) sigma.kill();
	});

	// ---- public API (called from the toolbar / panels) ----
	export function fitToView() {
		fitAll(sigma, graph);
	}

	export function zoomToTeam(teamId) {
		zoomCameraToTeam(sigma, graph, teamId);
	}

	export function hoverPartner(nodeId) {
		if (!graph) return;
		hoveredOther = nodeId != null ? String(nodeId) : null;
		if (sigma) sigma.refresh({ skipIndexation: true });
	}

	export function setEdgeAlpha(lo, hi) {
		if (!graph) return;
		graph.setAttribute("edgeAlphaMin", lo);
		graph.setAttribute("edgeAlphaMax", hi);
		if (sigma) sigma.refresh({ skipIndexation: true });
	}

	export function setEdgeColorMode(mode) {
		if (!graph) return;
		graph.setAttribute("edgeColorMode", mode);
		if (sigma) sigma.refresh({ skipIndexation: true });
	}

	export function selectEdge(sourceId, targetId) {
		if (!sigma || !graph) return;
		const source = String(sourceId);
		const target = String(targetId);
		const edge = graph.edge(source, target) ?? graph.edge(target, source);
		if (edge == null) return;
		onEdgeSelect(edgeSelection(graph, edge));
	}

	export function forceRebuild() {
		const seed = circularSeed(graph);
		rebuild(viewNodes, viewLinks, seed);
	}
</script>

<div class="graph-host" bind:this={host}>
	{#if tip.visible}
		<div class="edge-tip" style="left:{tip.x}px;top:{tip.y}px">{tip.text}</div>
	{/if}
</div>