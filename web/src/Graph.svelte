<script lang="ts">
	import { onDestroy as _onDestroy } from "svelte";
	import { untrack } from "svelte";
	import { GraphController } from "./GraphController.ts";
	import { clearSubsetCache } from "./lib.ts";
	import type { ParsedGraph, EdgeSelection, LayoutStatePayload } from "./types.ts";

	let {
		viewNodes,
		viewLinks,
		teams,
		prevPos = new Map(),
		selectedId,
		selectedEdge: _selectedEdge,
		onSelect,
		onEdgeSelect = () => {},
		onStageClick = () => {},
		onNodeHover = () => {},
		onNodeTeamHover = () => {},
		onLayoutState = () => {},
		edgeColor = "winrate",
		alphaMin = 0.05,
		alphaMax = 0.6,
		winRates = new Map(),
		showEdges = true,
		nodeColor = "jersey",
		matchEventId = null,
		minW = 1,
		maxW = 45,
		minD = 1,
		maxD = 90,
		dateStart = null,
		dateEnd = null,
	} = $props();

	let host: HTMLDivElement;
	let controller: GraphController | null = null;
	let built = $state(false);
	let layoutSettled = $state(false);
	let prevFilters = $state("");

	const initialGraph: ParsedGraph = {
		nodes: [],
		links: [],
		teams: {},
		maxGlobalDeg: 1,
		dateMin: null,
		dateMax: null,
		winRates: new Map(),
		games: [],
		playerTeamDates: new Map(),
	};

	$effect(() => {
		if (!host) return;
		controller = new GraphController({
			host,
			initialGraph,
			prevPos: prevPos as Map<number, { x: number; y: number }>,
			callbacks: {
				onLayoutState: (state: LayoutStatePayload) => {
					if (!state.first && !state.running) {
						layoutSettled = true;
					}
					onLayoutState(state);
				},
			onSelect: (id: number | null) => {
				controller?.activateNode(id);
				onSelect(id);
			},
			onEdgeSelect: (edge: EdgeSelection | null) => {
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
			getMatchEventId: () => untrack(() => matchEventId),
			getViewNodes: () => untrack(() => viewNodes),
			getViewLinks: () => untrack(() => viewLinks),
			getSelectedId: () => untrack(() => selectedId),
		});
		return () => controller?.dispose();
	});

	$effect(() => {
		if (!controller || !built) return;
		if (!layoutSettled) return;
		const filters = `${minW}|${maxW}|${minD}|${maxD}|${dateStart ?? ""}|${dateEnd ?? ""}`;
		if (filters === prevFilters) return;
		prevFilters = filters;
		clearSubsetCache();
		controller.refreshLayout();
	});

	$effect(() => {
		if (!controller) return;
		built = true;
	});

	$effect(() => {
		if (!controller || !built) return;
		nodeColor; teams;
		controller.recolorNodes();
	});

	$effect(() => {
		if (!controller || !built) return;
		showEdges; selectedId;
		controller.refresh();
	});

	let prevMatchEventId = $state<number | null>(null);
	$effect(() => {
		if (!controller || !built) return;
		// Rebuild the graph whenever the match view toggles. Driven by
		// matchEventId (not the view nodes/links references) because
		// visibleSubset() caches and returns identical object references,
		// which would otherwise prevent the rebuild effect from re-firing.
		if (matchEventId != null || prevMatchEventId != null) {
			controller.refreshLayout();
		}
		prevMatchEventId = matchEventId;
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

	export function activateNode(nodeId: number | null) {
		controller?.activateNode(nodeId);
	}

	export function hoverTeam(teamId: number | null) {
		controller?.hoverTeam(teamId);
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
</script>

<div class="graph-host" bind:this={host}>
	{#if tip.visible}
		<div class="edge-tip" style="left:{tip.x}px;top:{tip.y}px">{tip.text}</div>
	{/if}
</div>
