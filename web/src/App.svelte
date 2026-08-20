<script lang="ts">
import { onMount } from "svelte";
import { fade } from "svelte/transition";
import { parseGraph, visibleSubset, clearSubsetCache, JERSEY_COLORS, hydrateParsedGraph } from "./lib.ts";
import Controls from "./Controls.svelte";
import UnifiedSearch from "./UnifiedSearch.svelte";
import Hud from "./Hud.svelte";
import MatchHud from "./MatchHud.svelte";
import MatchPlayerInfo from "./MatchPlayerInfo.svelte";
import Timeline from "./Timeline.svelte";
import type { Player, Link, ParsedGraph, ParsedGraphData, PlayerMatch, EdgeSelection, Game } from "./types.ts";

const graphModule = import("./Graph.svelte").then((m) => m.default);
let graph = $state<ParsedGraph | null>(null);
	let minW = $state(1);
	let minD = $state(1);
	let dateStart = $state<string | null>(null);
	let dateEnd = $state<string | null>(null);
	let selectedId = $state<number | null>(null);
	let _selectedEdge = $state<EdgeSelection | null>(null);
	let hoveredTeammate = $state<number | null>(null);
	let hoveredJersey = $state<[number | null, number | null]>([null, null]);
	let secondaryId = $state<number | null>(null);
	let activeMatch = $state<Game | null>(null);
	let edgeColor = $state("winrate");
	let alphaMin = $state(0.05);
	let alphaMax = $state(0.6);
	let nodeColor = $state("team");
	let showEdges = $state(false);
	let showCoaches = $state(true);
	let showMetaballs = $state(false);
	let showGrid = $state(true);

	let graphCmp = $state<{
		fitToView: () => void;
		zoomToTeam: (teamId: number | null) => void;
		hoverPartner: (nodeId: number | null) => void;
		hoverTeam: (teamId: number | null) => void;
		hoverNode: (nodeId: number | null) => void;
		hoverJersey: (homeId: number | null, awayId: number | null) => void;
		hoverMatch: (nodeIds: number[] | null) => void;
		setEdgeAlpha: (lo: number, hi: number) => void;
		setEdgeColorMode: (mode: string) => void;
		selectEdge: (sourceId: number, targetId: number) => void;
		activateNode: (nodeId: number | null) => void;
		forceRebuild: () => void;
		refreshLayout: () => void;
	} | null>(null);

let loadPhase = $state<"data" | "building" | "ready">("data");
let loadError = $state<string | null>(null);

let timelineOpen = $state(false);

let playerMatchIndex = $state<Map<number, PlayerMatch[]>>(new Map());
let coachMatchIndex = $state<Map<number, PlayerMatch[]>>(new Map());

// Panel open state for auto-clear selection when panel closes
let clearPending = $state(false);
$effect(() => {
    if (panelOpen) {
        if (clearPending) {
            clearPending = false;
        }
    } else if (!clearPending) {
        clearSelection();
        clearPending = true;
    }
});

const nodes = $derived(graph ? [...graph.nodes, ...graph.coachNodes] : []);
const links = $derived(graph ? graph.links : []);
	const teams = $derived(graph ? graph.teams : {});
	const maxGlobalDeg = $derived(graph ? graph.maxGlobalDeg : 1);
	const posByNode = new Map<number, { x: number; y: number }>();
	const matchPlayers = $derived(
		activeMatch ? new Set((activeMatch.competitors || []).flatMap((c) => (c.roster || []).map((e) => e.playerId))) : null,
	);
	const matchTeamOf = $derived(
		activeMatch ? new Map((activeMatch.competitors || []).flatMap((c) => (c.roster || []).map((e) => [e.playerId, c.teamId]))) : null,
	);
	const matchCoaches = $derived(
		activeMatch
			? new Set(
					(activeMatch.competitors || [])
						.map((c) => c.coachNodeId)
						.filter((x): x is number => x != null),
				)
			: null,
	);
	const view = $derived(
		graph
			? visibleSubset(
					nodes,
					links,
					{ minW, minD, dateStart, dateEnd, showCoaches },
					posByNode,
					graph.playerTeamDates,
					matchPlayers,
					matchTeamOf,
					matchCoaches,
				)
			: { nodes: [] as Player[], links: [] as Link[] },
	);

$effect(() => {
    minW; minD; dateStart; dateEnd;
	// Drive the graph rebuild directly whenever a filter changes. The
	// Graph.svelte filter effect is gated behind `layoutReady` (set true as
	// soon as the layout starts running), which blocks the first interaction,
	// so we call refreshLayout() from here to guarantee the sigma graph is
	// rebuilt (and the header stat updates) on every change.
    if (graphCmp) {
        clearSubsetCache();
        graphCmp.refreshLayout();
    }
});

	const maxWeight = $derived(graph ? Math.max(1, ...graph.links.map((l) => l.w)) : 1);

	const windowTotal = $derived.by(() => {
		if (!graph) return 0;
		return links.filter((l) =>
			l.dates.some((d) => (!dateStart || d >= dateStart) && (!dateEnd || d <= dateEnd)),
		).length;
	});

	const jerseyColor = (j: number | null | undefined) =>
		j == null || j < 1 || j > 23 ? "#8e8e93" : JERSEY_COLORS[j - 1];

	const teamColor = (tid: number | null | undefined) => {
		if (tid == null) return "#8e8e93";
		const t = teams[tid];
		if (t && typeof t === "object" && "color" in t && t.color) return t.color as string;
		return "#8e8e93";
	};
	const selectedNode = $derived(selectedId != null ? view.nodes.find((n) => n.id === selectedId) : null);
	// A selection made while the match view is open refers to a player or
	// coach of that match: show the match-context pane instead of the global
	// profile.
	const matchSelection = $derived<{ match: Game; playerId: number } | null>(
		activeMatch == null || selectedId == null
			? null
			: (activeMatch.competitors ?? []).some(
					(c) =>
						(c.roster ?? []).some((e) => e.playerId === selectedId) ||
						c.coachNodeId === selectedId,
				)
				? { match: activeMatch, playerId: selectedId }
				: null,
	);
	const panelOpen = $derived(Boolean(selectedNode || _selectedEdge || activeMatch));
	const selectedDeg = $derived(
		selectedId != null ? (view.nodes.find((n) => n.id === selectedId)?.deg ?? 0) : 0,
	);

	const winRates = $derived(graph ? graph.winRates : new Map());
	// Name lookup must cover EVERY player that can appear in a roster, not just
	// graph nodes: match rosters include players with no co-occurrence edges
	// (or filtered out) who are absent from `nodes`. Seed from node names, then
	// register every roster id seen in `graph.games`, falling back to the id so
	// playerName never returns a blank "?" for a player that exists in the data.
	const nodesById = $derived.by(() => {
		const m = new Map<number, string>();
		for (const n of nodes || []) m.set(n.id, n.name);
		for (const g of graph?.games ?? []) {
			for (const c of g.competitors || []) {
				for (const e of c.roster || []) {
					if (!m.has(e.playerId)) m.set(e.playerId, String(e.playerId));
				}
			}
		}
		return m;
	});
	const playerName = (id: number) => nodesById.get(id) ?? "?";

	const partners = $derived.by(() => {
		if (!selectedNode) return [];
		return view.links
			.filter((l) => l.source.id === selectedId || l.target.id === selectedId)
			.sort((a, b) => b.w - a.w);
	});

	const playerMatches = $derived.by(() => {
		if (selectedId == null) return [] as PlayerMatch[];
		const isCoach = selectedNode?.isCoach;
		const sideFor = (g: any) =>
			isCoach
				? (g.competitors || []).find((c: any) => c.coachNodeId === selectedId)
				: (g.competitors || []).find((c: any) =>
						(c.roster || []).some((e: any) => e.playerId === selectedId),
					);
		const matches = isCoach ? coachMatchIndex.get(selectedId) : playerMatchIndex.get(selectedId);
		if (!matches) return [];
		const inFilterRange = (d: string) => (!dateStart || d >= dateStart) && (!dateEnd || d <= dateEnd);
		return matches
			.filter((m) => inFilterRange(m.date))
			.map((m) => {
				const side = sideFor(m.g);
				const opp = side ? (m.g.competitors || []).find((c: any) => c !== side) : null;
				const my = side?.score ?? null;
				const their = opp?.score ?? null;
				return {
					...m,
					myTeamId: side?.teamId ?? 0,
					oppId: opp?.teamId ?? null,
					home: Boolean(side?.home),
					my,
					opp: their,
					winner:
						my != null && their != null && my > their
							? side!.teamId
							: my != null && their != null && their > my
								? opp!.teamId
								: null,
				};
			})
			.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
	});

	const secondaryMatches = $derived.by(() => {
		if (secondaryId == null) return new Set<number>();
		const ms = playerMatchIndex.get(secondaryId);
		return new Set((ms ?? []).map((m) => m.g.eventId));
	});

	onMount(async () => {
		try {
			const resp = await fetch("/data/graph.json");
			const text = await resp.text();

			// Yield to event loop so loading overlay renders before heavy parse
			await new Promise((r) => setTimeout(r, 0));

			// Parse in Web Worker to keep main thread responsive
			const worker = new Worker(new URL("./parseWorker.ts", import.meta.url), { type: "module" });
			const parsedData: ParsedGraphData = await new Promise((resolve, reject) => {
				const id = Date.now();
				worker.onmessage = (e: MessageEvent<{ id: number; result: ParsedGraphData | null; error: string | null }>) => {
					if (e.data.id !== id) return;
					worker.terminate();
					if (e.data.error) reject(new Error(e.data.error));
					else resolve(e.data.result!);
				};
				worker.postMessage({ text, id });
			});

			graph = hydrateParsedGraph(parsedData);

			const index = new Map<number, PlayerMatch[]>();
			const coachIndex = new Map<number, PlayerMatch[]>();
			for (const g of graph.games || []) {
				for (const c of g.competitors || []) {
					for (const entry of c.roster || []) {
						const matches = index.get(entry.playerId) ?? [];
						matches.push({
							date: g.date || "",
							g,
							myTeamId: c.teamId,
							oppId: null,
							home: Boolean(c.home),
							my: c.score,
							opp: null,
							winner: null,
						});
						index.set(entry.playerId, matches);
					}
					if (c.coachNodeId != null) {
						const matches = coachIndex.get(c.coachNodeId) ?? [];
						matches.push({
							date: g.date || "",
							g,
							myTeamId: c.teamId,
							oppId: null,
							home: Boolean(c.home),
							my: c.score,
							opp: null,
							winner: null,
						});
						coachIndex.set(c.coachNodeId, matches);
					}
				}
			}
			playerMatchIndex = index;
			coachMatchIndex = coachIndex;

			if (!dateStart && !dateEnd) {
				const allDates = [...new Set((graph.games || []).map((g) => g.date).filter(Boolean))] as string[];
				if (allDates.length) {
					const sorted = [...allDates].sort();
					const maxDate = sorted[sorted.length - 1]!;
					const oneYearAgo = new Date(maxDate);
					oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
					dateStart = oneYearAgo.toISOString().slice(0, 10);
					dateEnd = maxDate;
				}
			}
			loadPhase = "building";
		} catch (err) {
			loadError = err instanceof Error && err.message ? err.message : String(err);
		}
	});

function deselectNodes() {
    selectedId = null;
    _selectedEdge = null;
    hoveredTeammate = null;
		hoveredJersey = [null, null];
    secondaryId = null;
    graphCmp?.activateNode(null);
}
function clearSelection() {
    deselectNodes();
}
/** Dismiss the info pane and recenter on the main graph view. */
function clearAndRecenter() {
    deselectNodes();
    graphCmp?.fitToView();
}
	function resetView() {
		minW = 1;
		minD = 1;
		dateStart = null;
		dateEnd = null;
		alphaMin = 0.05;
		alphaMax = 0.6;
		edgeColor = "winrate";
		nodeColor = "team";
		showEdges = false;
		selectedId = null;
		_selectedEdge = null;
		hoveredTeammate = null;
		hoveredJersey = [null, null];
		activeMatch = null;
		graphCmp?.forceRebuild();
	}
	function onGraphSelect(id: number | null) {
		selectedId = id;
		_selectedEdge = null;
		hoveredTeammate = null;
		hoveredJersey = [null, null];
		secondaryId = null;
		// Activate the node in the graph (the match-pane "Go to player"
		// buttons call this via onPick, and unlike a canvas click the
		// controller's activateNode isn't invoked automatically).
		graphCmp?.activateNode(id);
	}
	function onStageClick() {
		// The match view is only closed via its own close button; clicking the
		// graph stage must not dismiss it.
		if (activeMatch != null) return;
		clearAndRecenter();
	}
	function onEdgeSelect(edge: EdgeSelection | null) {
		_selectedEdge = edge;
		hoveredTeammate = null;
		hoveredJersey = [null, null];
		if (edge) {
			const s = Number(edge.source);
			const t = Number(edge.target);
			if (selectedId === s || selectedId === t) {
				secondaryId = selectedId === s ? t : s;
			} else {
				selectedId = s;
				secondaryId = t;
			}
		} else {
			secondaryId = null;
		}
	}
	function onMatchClick(game: any) {
		activeMatch = game;
		selectedId = null;
		_selectedEdge = null;
		hoveredTeammate = null;
		hoveredJersey = [null, null];
		secondaryId = null;
	}
	/** Leave the match view and focus the selected player's node in the global graph. */
	function onGoToGraphFromMatch() {
		activeMatch = null;
		_selectedEdge = null;
		hoveredTeammate = null;
		hoveredJersey = [null, null];
		secondaryId = null;
		// The graph is restored from the pre-match snapshot once the match
		// event effect flushes; pinch-focus the player's node right after.
		setTimeout(() => {
			if (selectedId != null) graphCmp?.activateNode(selectedId);
		}, 0);
	}
	function onPartnerHover(id: number | null) {
		graphCmp?.hoverPartner(id);
		hoveredTeammate = id;
		hoveredJersey = [null, null];
	}
	function onPlayerHover(id: number | null) {
		graphCmp?.hoverNode(id);
		// Mirror the node-hover path: hovering a roster row in the match pane
		// also lights up its row cell, same style as hovering the graph node.
		hoveredTeammate = id;
		hoveredJersey = [null, null];
	}
	function onJerseyHover(home: number | null, away: number | null) {
		graphCmp?.hoverJersey(home, away);
		hoveredJersey = [home, away];
		hoveredTeammate = null;
	}
	function onNodeHover(id: number | null) {
		// GraphController reports the node key (a string); roster and partner
		// ids are numbers, so normalise here for the strict-equality row/chip
		// highlights in the match and player panes.
		hoveredTeammate = id != null ? Number(id) : null;
		hoveredJersey = [null, null];
	}
	function onPartnerClick(l: { source: { id: number }; target: { id: number } }) {
		const partner = l.source.id === selectedId ? l.target.id : l.source.id;
		if (secondaryId != null && partner === secondaryId) {
			// Clicking the highlighted teammate again deselects it.
			_selectedEdge = null;
			secondaryId = null;
			hoveredTeammate = null;
		hoveredJersey = [null, null];
			graphCmp?.activateNode(selectedId);
		} else {
			graphCmp?.selectEdge(l.source.id, l.target.id);
		}
	}
	function onLayoutState({ running }: { running: boolean }) {
		if (!running) {
			loadPhase = "ready";
		}
	}
	function onGraphReady() {
		loadPhase = "ready";
	}
</script>

<svelte:window
	onclick={(ev) => {
		if (
			ev.target instanceof Element &&
			ev.target.isConnected &&
			!ev.target.closest(".graph-host, .unified-search, #hud, #match-hud, #match-player-info, header, .timeline-wrap")
		)
			clearAndRecenter();
	}}
	onkeydown={(ev) => {
		if (ev.key === "Escape") clearAndRecenter();
	}}
/>

<header class="bg-base-200/50 backdrop-blur-sm">
	<!-- Primary row: identity, search, primary action -->
	<div class="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
		<div class="min-w-0 flex-1">
			<h1 class="text-2xl font-bold">Rugby co-occurrence graph</h1>
			<div id="stats" class="text-sm text-base-content/60">
				{#if graph}
					{view.nodes.length} players &middot; {view.links.length} edges (of {windowTotal}) &middot;
					max degree {maxGlobalDeg}
				{:else}
					loading…
				{/if}
			</div>
		</div>

		<div class="w-full min-w-0 sm:w-80 lg:w-96">
			<UnifiedSearch
				nodes={nodes.filter((n) => !n.isCoach)}
				coaches={graph?.coachNodes ?? []}
				{teams}
				games={graph?.games ?? []}
				{playerName}
				onPickPlayer={(d) => onGraphSelect(d.id)}
				onPickMatch={onMatchClick}
				onPickTeam={(tid: number) => graphCmp?.zoomToTeam(tid)}
				onPickVenue={(v) => {
					const g = (graph?.games ?? [])
						.filter((gm) => gm.venue?.name === v.name)
						.sort((a, b) => (a.date! < b.date! ? 1 : a.date! > b.date! ? -1 : 0))[0];
					if (g) onMatchClick(g);
				}}
				{selectedId}
			/>
		</div>

		<button class="btn btn-primary" onclick={() => graphCmp?.fitToView()}>
			Recenter
		</button>
	</div>

	<!-- Filter strip: sliders, common toggles, secondary actions -->
	<div
		class="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-base-300/60 bg-base-100/40 px-4 py-2"
	>
		<div class="block">
			<Controls
				bind:minW
				bind:minD
				bind:edgeColor
				bind:alphaMin
				bind:alphaMax
				bind:nodeColor
				onEdgeAlpha={(lo: number, hi: number) => graphCmp?.setEdgeAlpha(lo, hi)}
				onEdgeColor={(mode: string) => graphCmp?.setEdgeColorMode(mode)}
				maxDeg={maxGlobalDeg}
				maxWeight={maxWeight}
				bind:showCoaches
				bind:showMetaballs
				bind:showGrid
				bind:showEdges
			/>
		</div>

		<div class="hidden h-5 w-px bg-base-300 md:block" aria-hidden="true"></div>

		<div class="ml-auto flex items-center gap-2">
			<button
				class="btn btn-ghost btn-sm"
				onclick={() => {
					graphCmp?.forceRebuild();
				}}
			>
				Rebuild Layout
			</button>
			<button class="btn btn-outline btn-sm" onclick={resetView}>
				Reset
			</button>
		</div>
	</div>
</header>

<div id="legend">
	<div><span class="sw" style="background:#5ac8fa"></span>node = player, size = appearances</div>
	<div>
		<span class="sw" style="background:#8e8e93"></span>edge = shared match, width = co-occurrences
	</div>
	<div>
		<span class="sw ramp"></span>edge colour by avg win rate: 0%&nbsp;&nbsp;50%&nbsp;&nbsp;100%
	</div>
	<div>
		color: <span style="color:{jerseyColor(1)}">■</span> 1 front row &nbsp;
		<span style="color:{jerseyColor(8)}">■</span>
		8 back row &nbsp; <span style="color:{jerseyColor(15)}">■</span> 15 fullback &nbsp;
		<span style="color:{jerseyColor(23)}">■</span> 23 bench
	</div>
</div>

<div class="graph-wrap">
	{#await graphModule}
		<div class="graph-host" aria-hidden="true"></div>
	{:then Graph}
	<Graph
		bind:this={graphCmp}
		viewNodes={view.nodes}
		viewLinks={view.links}
		{teams}
		prevPos={posByNode}
		{selectedId}
		{secondaryId}
		selectedEdge={_selectedEdge}
		{edgeColor}
		{alphaMin}
		{alphaMax}
		{winRates}
		{showEdges}
		{nodeColor}
		{showMetaballs}
		{showCoaches}
		matchEventId={activeMatch?.eventId ?? null}
		{minW}
		{minD}
		{dateStart}
		{dateEnd}
		onSelect={onGraphSelect}
		onSelectSecondary={(id: number | null) => {
			secondaryId = id;
		}}
		onStageClick={onStageClick}
		onEdgeSelect={onEdgeSelect}
		onNodeHover={onNodeHover}
		onLayoutState={onLayoutState}
		onGraphReady={onGraphReady}
	/>
	{/await}

	{#if loadError}
		<div class="load-overlay">
			<div class="load-card load-error">
				Failed to load graph data{loadError ? `: ${loadError}` : ""}.
			</div>
		</div>
	{:else if loadPhase !== "ready"}
		<div class="load-overlay" transition:fade={{ duration: 250 }}>
			<div class="load-card">
				<div class="load-spinner"></div>
				<div class="load-text">
					{#if loadPhase === "data"}
						Loading player data…
					{:else}
						Preparing graph…
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<div id="panels" class:panel-active={selectedNode || _selectedEdge || activeMatch}>
		{#if selectedNode || _selectedEdge || activeMatch}
		<div id="side-panel">
			{#if matchSelection}
				<MatchPlayerInfo
					match={matchSelection.match}
					playerId={matchSelection.playerId}
					{playerName}
					{teams}
					{teamColor}
					onGoToGraph={onGoToGraphFromMatch}
					onClose={() => deselectNodes()}
				/>
			{:else if selectedNode}
				<Hud
				node={selectedNode}
				deg={selectedDeg}
				{partners}
				{teams}
				{playerMatches}
				{secondaryId}
				{secondaryMatches}
				onClear={clearAndRecenter}
				onPartnerHover={onPartnerHover}
				onPartnerClick={onPartnerClick}
				{hoveredTeammate}
				{onMatchClick}
				onMatchHover={(ids) => graphCmp?.hoverMatch(ids)}
				activeMatch={activeMatch?.eventId ?? null}
				onTeamZoom={(tid) => {
					deselectNodes();
					graphCmp?.zoomToTeam(tid);
				}}
			/>
			{/if}
			<MatchHud
				match={activeMatch}
				{teams}
				{playerName}
				{teamColor}
			onClose={() => {
				activeMatch = null;
			}}
				onPick={onGraphSelect}
				onHoverTeam={(tid) => graphCmp?.hoverTeam(tid)}
				onPlayerHover={onPlayerHover}
				hoveredPlayerId={hoveredTeammate}
				hoveredJersey={hoveredJersey}
				onJerseyHover={onJerseyHover}
			/>
		</div>
		{/if}
	</div>
</div>

<Timeline
	graphGames={graph?.games ?? []}
	bind:dateStart
	bind:dateEnd
	bind:activeMatch
	bind:showTimeline={timelineOpen}
	/>
