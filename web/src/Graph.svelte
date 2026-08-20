<script lang="ts">
	import { onDestroy as _onDestroy } from "svelte";
	import { untrack } from "svelte";
	import { GraphController } from "./GraphController.ts";
	import { clearSubsetCache } from "./lib.ts";
	import * as types from "./types.ts";
	import type { LayoutTickStats } from "./graph/layout.ts";

let host: HTMLElement | null = null;

  let controller = $state<GraphController | null>(null);
	let built = $state(false);
	let layoutReady = $state(false);
	let prevFilters = "";
	let prevMatchEventId: number | null = null;

	let {
		viewNodes,
		viewLinks,
		teams,
		prevPos = new Map(),
		selectedId,
		secondaryId = null,
		selectedEdge: _selectedEdge,
		onSelect,
		onSelectSecondary = () => {},
		onEdgeSelect = () => {},
		onStageClick = () => {},
		onNodeHover = () => {},
		onNodeTeamHover = () => {},
		onLayoutState = () => {},
		onGraphReady = () => {},
		edgeColor = "winrate",
		alphaMin = 0.05,
		alphaMax = 0.6,
		winRates = new Map(),
		showEdges = true,
		nodeColor = "jersey",
		showMetaballs = false,
		showGrid = true,
		showCoaches = true,
		matchEventId = null,
		minW = 1,
		minD = 1,
		dateStart = null,
		dateEnd = null,
	} = $props();

	const matchEventIdValue = $derived(matchEventId);
	function unwrapMatchEventId(val: typeof matchEventId): number | null {
		if (val == null) return null;
		if (typeof val === 'number') return val;
		return null;
	}

	const initialGraph: types.ParsedGraph = {
		nodes: [],
		coachNodes: [],
		links: [],
		teams: {},
		maxGlobalDeg: 1,
		dateMin: null,
		dateMax: null,
		winRates: new Map(),
		games: [],
		playerTeamDates: new Map(),
		coachTeamDates: new Map(),
	};

	$effect(() => {
		if (!host) return;
		controller = new GraphController({
				host,
				initialGraph,
				prevPos: prevPos as Map<number, { x: number; y: number }>,
				callbacks: {
					onLayoutState: (state: types.LayoutStatePayload) => {
					layoutReady = true;
					onLayoutState(state);
					},
					onGraphReady: () => {
						onGraphReady?.();
					},
				onSelect: (id: number | null) => {
					controller?.activateNode(id);
					onSelect(id ? Number(id) : null);
				},
				onSelectSecondary: (id: number | null) => {
					// Re-pin the primary node (clearing the secondary highlight)
					// and report the secondary deselection back to the app.
					if (selectedId != null) controller?.activateNode(selectedId);
					onSelectSecondary(id ? Number(id) : null);
				},
				onEdgeSelect: (edge: types.EdgeSelection | null) => {
					controller?.activateEdge(edge?.key ?? null);
					onEdgeSelect(edge);
				},
				onStageClick: () => {
					controller?.clearSelection();
					onStageClick();
				},
					onNodeHover: (id: string | null) => onNodeHover(id),
					onNodeTeamHover: (teamId: number | null) => onNodeTeamHover(teamId),
					onTooltip: (t) => {
						if (t) tip = { x: t.x, y: t.y, visible: t.visible, text: t.text };
						else tip = { x: 0, y: 0, visible: false, text: "" };
					},
				},
				getTeams: () => untrack(() => teams),
				getNodeColor: () => untrack(() => nodeColor),
				getEdgeColor: () => untrack(() => edgeColor),
				getAlphaMin: () => untrack(() => alphaMin),
				getAlphaMax: () => untrack(() => alphaMax),
				getWinRates: () => untrack(() => winRates),
				getShowEdges: () => untrack(() => showEdges),
				getMatchEventId: () => matchEventId,
				getViewNodes: () => untrack(() => viewNodes),
				getViewLinks: () => untrack(() => viewLinks),
				getSelectedId: () => untrack(() => selectedId),
				getSecondaryId: () => untrack(() => secondaryId),
			getShowMetaballs: () => untrack(() => showMetaballs),
			getShowGrid: () => untrack(() => showGrid),
		});
		return () => controller?.dispose();
	});

	$effect(() => {
		if (!controller || !built) return;
		if (!layoutReady) return;
		const currentFilters = `${minW}|${minD}|${dateStart ?? ""}|${dateEnd ?? ""}|${showCoaches}`;
		if (currentFilters === prevFilters) return;
		prevFilters = currentFilters;
		clearSubsetCache();
		controller.refreshLayout();
	});

	$effect(() => {
		if (!controller) return;
		built = true;
	});

	$effect(() => {
		if (!controller || !built) return;
		if (viewNodes.length === 0 || viewLinks.length === 0) return;
		controller.refreshLayout();
	});

	$effect(() => {
		if (!controller || !built || !layoutReady) return;
		nodeColor; teams;
		controller.recolorNodes();
	});

	$effect(() => {
		if (!controller || !built || !layoutReady) return;
		showEdges; selectedId;
		controller.refresh();
	});

	$effect(() => {
		if (!controller) return;
		showMetaballs;
		controller.setShowMetaballs(showMetaballs);
	});

	$effect(() => {
		if (!controller) return;
		showGrid;
		controller.setShowGrid(showGrid);
	});

$effect(() => {
		if (!controller || !built) return;
		const currentMatchEventId = unwrapMatchEventId(matchEventIdValue);
		if (currentMatchEventId !== prevMatchEventId) {
			controller.refreshLayout(true);
		}
		prevMatchEventId = currentMatchEventId;
	});

	let tip = $state({ x: 0, y: 0, visible: false, text: "" });

	export function fitToView() {
		controller?.fitToView();
	}

	export function zoomToTeam(teamId: number | null) {
		controller?.zoomToTeam(teamId ?? 0);
	}

  export function hoverPartner(nodeId: number | null) {
		controller?.hoverPartner(nodeId);
	}

	export function hoverNode(nodeId: number | null) {
		controller?.hoverNode(nodeId);
	}

	export function hoverJersey(homeId: number | null, awayId: number | null) {
		controller?.hoverJersey(homeId, awayId);
	}

	export function activateNode(nodeId: number | null) {
		controller?.activateNode(nodeId);
	}

	export function hoverTeam(teamId: number | null) {
		controller?.hoverTeam(teamId);
	}

	export function hoverMatch(nodeIds: number[] | null) {
		controller?.hoverMatch(nodeIds);
	}

	export function setEdgeAlpha(lo: number, hi: number) {
		controller?.setEdgeAlpha(lo, hi);
	}

	export function setEdgeColorMode(mode: string) {
		controller?.setEdgeColorMode(mode);
	}

	export function selectEdge(sourceId: number, targetId: number) {
		controller?.selectEdge(sourceId, targetId);
	}

	export function forceRebuild() {
		controller?.forceRebuild();
	}

	export function refreshLayout() {
		controller?.refreshLayout();
	}

	export function getDebugStats(): LayoutTickStats[] {
		return controller?.getDebugStats() ?? [];
	}
</script>

<div class="graph-host" bind:this={host}>
	{#if tip.visible}
		<div class="edge-tip" style="left:{tip.x}px;top:{tip.y}px">{tip.text}</div>
	{/if}
</div>
