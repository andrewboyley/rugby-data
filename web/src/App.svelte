<script lang="ts">
	import { onMount, untrack } from "svelte";
	import { fade } from "svelte/transition";
	import { parseGraph, visibleSubset, clearSubsetCache } from "./lib.ts";
	import Controls from "./Controls.svelte";
	import Search from "./Search.svelte";
	import Hud from "./Hud.svelte";
	import EdgeHud from "./EdgeHud.svelte";
	import MatchHud from "./MatchHud.svelte";
	import type { Player, Link, ParsedGraph, PlayerMatch, EdgeSelection, Game } from "./types.ts";

	const graphModule = import("./Graph.svelte").then((m) => m.default);

	let graph = $state<ParsedGraph | null>(null);
	let minW = $state(1);
	let maxW = $state(45);
	let maxWCap = $state(45);
	let minD = $state(1);
	let maxD = $state(90);
	let dateStart = $state<string | null>(null);
	let dateEnd = $state<string | null>(null);
	let selectedId = $state<number | null>(null);
	let _selectedEdge = $state<EdgeSelection | null>(null);
	let hoveredTeammate = $state<number | null>(null);
	let hoveredTeamId = $state<number | null>(null);
	let activeMatch = $state<Game | null>(null);
	let gamesByDate = $state<Map<string, ParsedGraph["games"]>>(new Map());
	let edgeColor = $state("winrate");
	let alphaMin = $state(0.05);
	let alphaMax = $state(0.6);
	let nodeColor = $state("team");
	let showEdges = $state(false);
	let graphCmp = $state<{
		fitToView: () => void;
		zoomToTeam: (teamId: number | null) => void;
		hoverPartner: (nodeId: number | null) => void;
		hoverTeam: (teamId: number | null) => void;
		hoverNode: (nodeId: number | null) => void;
		setEdgeAlpha: (lo: number, hi: number) => void;
		setEdgeColorMode: (mode: string) => void;
		selectEdge: (sourceId: number, targetId: number) => void;
		activateNode: (nodeId: number | null) => void;
		forceRebuild: () => void;
		refreshLayout: () => void;
	} | null>(null);

	let loadPhase = $state<"data" | "building" | "ready">("data");
	let loadError = $state<string | null>(null);

	let playerMatchIndex = $state<Map<number, PlayerMatch[]>>(new Map());

	const nodes = $derived(graph ? graph.nodes : []);
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
	const view = $derived(
		graph
			? visibleSubset(
					nodes,
					links,
					minW,
					maxW,
					minD,
					maxD,
					dateStart,
					dateEnd,
					posByNode,
					graph.playerTeamDates,
					matchPlayers ?? undefined,
					matchTeamOf ?? undefined,
				)
			: { nodes: [] as Player[], links: [] as Link[] },
	);

	$effect(() => {
		minW; maxW; minD; maxD; dateStart; dateEnd;
		if (untrack(() => activeMatch) != null) {
			activeMatch = null;
		}
		// Drive the graph rebuild directly whenever a filter changes. The
		// Graph.svelte filter effect is gated behind `layoutSettled` (only set
		// true after a non-first layout settles), which blocks the first
		// interaction, so we call refreshLayout() from here to guarantee the
		// sigma graph is rebuilt (and the header stat updates) on every change.
		if (graphCmp) {
			clearSubsetCache();
			graphCmp.refreshLayout();
		}
	});

	const windowTotal = $derived.by(() => {
		if (!graph) return 0;
		return links.filter((l) =>
			l.dates.some((d) => (!dateStart || d >= dateStart) && (!dateEnd || d <= dateEnd)),
		).length;
	});

	const jerseyColor = (j: number | null | undefined) =>
		j == null || j < 1 || j > 23 ? "#8e8e93" : TURBO[j - 1];

	const teamColor = (tid: number | null | undefined) => {
		if (tid == null) return "#8e8e93";
		const t = teams[tid];
		if (t && typeof t === "object" && "color" in t && t.color) return t.color as string;
		return "#8e8e93";
	};
	const selectedNode = $derived(selectedId != null ? view.nodes.find((n) => n.id === selectedId) : null);
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
		const matches = playerMatchIndex.get(selectedId);
		if (!matches) return [];
		const sideFor = (g: any) =>
			(g.competitors || []).find((c: any) => (c.roster || []).some((e: any) => e.playerId === selectedId));
		return matches
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

	onMount(async () => {
		try {
			const text = await fetch("/data/graph.json").then((r) => r.text());
			graph = parseGraph(text);
			maxD = graph.maxGlobalDeg;
			const maxEW = graph.links.reduce((m, l) => Math.max(m, l.w), 0);
			maxWCap = Math.max(1, maxEW);
			maxW = maxWCap;

			const index = new Map<number, PlayerMatch[]>();
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
				}
			}
			playerMatchIndex = index;

			const dateIdx = new Map<string, ParsedGraph["games"]>();
			for (const g of graph.games || []) {
				if (!g.date) continue;
				const arr = dateIdx.get(g.date) ?? [];
				arr.push(g);
				dateIdx.set(g.date, arr);
			}
			gamesByDate = dateIdx;

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

	function clearSelection() {
		selectedId = null;
		_selectedEdge = null;
		hoveredTeammate = null;
	}
	function clearEdge() {
		_selectedEdge = null;
		hoveredTeammate = null;
		activeMatch = null;
	}
	function resetView() {
		minW = 1;
		maxW = maxWCap;
		minD = 1;
		maxD = graph ? graph.maxGlobalDeg : 90;
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
		activeMatch = null;
		graphCmp?.forceRebuild();
	}
	function onGraphSelect(id: number | null) {
		selectedId = id;
		_selectedEdge = null;
		hoveredTeammate = null;
		// Activate the node in the graph (the match-pane "Go to player"
		// buttons call this via onPick, and unlike a canvas click the
		// controller's activateNode isn't invoked automatically).
		graphCmp?.activateNode(id);
	}
	function onStageClick() {
		activeMatch = null;
		clearSelection();
	}
	function onEdgeSelect(edge: EdgeSelection | null) {
		_selectedEdge = edge;
		hoveredTeammate = null;
		activeMatch = null;
	}
	function onMatchClick(game: any) {
		activeMatch = game;
		selectedId = null;
		_selectedEdge = null;
		hoveredTeammate = null;
	}
	function onPartnerHover(id: number | null) {
		graphCmp?.hoverPartner(id);
		hoveredTeammate = id;
	}
	function onPlayerHover(id: number | null) {
		graphCmp?.hoverNode(id);
	}
	function onNodeHover(id: number | null) {
		hoveredTeammate = id;
	}
	function onPartnerClick(l: { source: { id: number }; target: { id: number } }) {
		graphCmp?.selectEdge(l.source.id, l.target.id);
	}
	function onLayoutState({ running, first }: { running: boolean; first: boolean }) {
		if (!first) return;
		if (running) loadPhase = "ready";
	}

	const TURBO = [
		"#23171b", "#453390", "#4a52d4", "#4172f3", "#3491f8",
		"#29afeb", "#25cad4", "#2bdfb7", "#3af099", "#53fa7d",
		"#73fe64", "#96fa50", "#baf040", "#dae034", "#f3c92b",
		"#ffae25", "#ff9020", "#ff701a", "#eb5015", "#d0330e",
		"#b21c06", "#990e00", "#900d00",
	];
</script>

<svelte:window
	onclick={(ev) => {
		if (
			ev.target instanceof Element &&
			!ev.target.closest(".graph-host, .search-wrap, #hud, #edge-hud, #match-hud, header")
		)
			clearSelection();
	}}
	onkeydown={(ev) => {
		if (ev.key === "Escape") clearSelection();
	}}
/>

<header>
	<h1>Rugby co-occurrence graph</h1>
	<div id="stats">
		{#if graph}
			{view.nodes.length} players &middot; {view.links.length} edges (of {windowTotal}) &middot; max
			degree {maxGlobalDeg}
		{:else}
			loading…
		{/if}
	</div>
	<Controls
		bind:minW
		bind:maxW
		bind:minD
		bind:maxD
		bind:dateStart
		bind:dateEnd
		bind:edgeColor
		bind:alphaMin
		bind:alphaMax
		bind:nodeColor
		{teams}
		onTeamZoom={(tid: number | null) => graphCmp?.zoomToTeam(tid)}
		onEdgeAlpha={(lo: number, hi: number) => graphCmp?.setEdgeAlpha(lo, hi)}
		onEdgeColor={(mode: string) => graphCmp?.setEdgeColorMode(mode)}
		maxDeg={maxGlobalDeg}
		maxWCap={maxWCap}
		dateMin={graph ? graph.dateMin : null}
		dateMax={graph ? graph.dateMax : null}
	/>
	<Search {nodes} {teams} {selectedId} onPick={(d) => (selectedId = d.id)} />
	<button class="btn" onclick={() => graphCmp?.fitToView()}>Recenter</button>
	<button class="btn" onclick={() => { activeMatch = null; graphCmp?.forceRebuild(); }}>Rebuild Layout</button>
	<label class="check-control" title="Show all edges"><input type="checkbox" bind:checked={showEdges} /> Show Edges</label>
	<button class="btn" onclick={resetView}>Reset</button>
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
		selectedEdge={_selectedEdge}
		{edgeColor}
		{alphaMin}
		{alphaMax}
		{winRates}
		{showEdges}
		{nodeColor}
		matchEventId={activeMatch?.eventId ?? null}
		{minW}
		{maxW}
		{minD}
		{maxD}
		{dateStart}
		{dateEnd}
		onSelect={onGraphSelect}
		onStageClick={onStageClick}
		onEdgeSelect={onEdgeSelect}
		onNodeHover={onNodeHover}
		onNodeTeamHover={(tid: number | null) => {
			if (activeMatch) hoveredTeamId = tid;
		}}
		onLayoutState={onLayoutState}
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

	<div id="panels">
		<Hud
			node={selectedNode}
			deg={selectedDeg}
			{partners}
			{teams}
			{playerMatches}
			onClear={clearSelection}
			onPartnerHover={onPartnerHover}
			onPartnerClick={onPartnerClick}
			{hoveredTeammate}
			{onMatchClick}
			activeMatch={activeMatch?.eventId ?? null}
			onTeamZoom={(tid) => {
				clearSelection();
				graphCmp?.zoomToTeam(tid);
			}}
		/>
		<EdgeHud edge={_selectedEdge} {gamesByDate} {teams} onClear={clearEdge} {onMatchClick} {activeMatch} />
		<MatchHud
			match={activeMatch}
			{teams}
			{playerName}
			{teamColor}
			onClose={() => {
				activeMatch = null;
				hoveredTeamId = null;
			}}
			onPick={onGraphSelect}
			onHoverTeam={(tid) => graphCmp?.hoverTeam(tid)}
			onPlayerHover={onPlayerHover}
			{hoveredTeamId}
			hoveredPlayerId={hoveredTeammate}
		/>
	</div>
</div>
