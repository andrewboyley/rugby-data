<script>
	import { onMount } from "svelte";
	import { fade } from "svelte/transition";
	import { parseGraph, visibleSubset } from "./lib.js";
	import Controls from "./Controls.svelte";
	import Search from "./Search.svelte";
	import Hud from "./Hud.svelte";
	import EdgeHud from "./EdgeHud.svelte";
	import MatchHud from "./MatchHud.svelte";

	// Graph.svelte pulls in sigma/graphology/forceatlas2 (the heaviest modules
	// in the bundle). Load it lazily so the page shell paints before the graph
	// stack evaluates on the main thread.
	const graphModule = import("./Graph.svelte").then((m) => m.default);

	let graph = $state(null);
	let minW = $state(1);
	let maxW = $state(45);
	let maxWCap = $state(45);
	let minD = $state(1);
	let maxD = $state(90);
	let dateStart = $state(null);
	let dateEnd = $state(null);
	let selectedId = $state(null);
	let selectedEdge = $state(null);
	let hoveredTeammate = $state(null);
	// When a game in the match history is clicked, restrict the visible graph
	// to the players who took part. Stores the game object so the panel can
	// mark the active row; undefined means "no match focus".
	let activeMatch = $state(null);
	let gamesByDate = $state(new Map());
	let edgeColor = $state("winrate");
	let alphaMin = $state(0.05);
	let alphaMax = $state(0.6);
	let nodeColor = $state("team");
	let showEdges = $state(false);
	let graphCmp = $state(null);

	// Initial-load indicator phases: "data" (fetching graph.json), "building"
	// (module + first graph build), then dismissed as soon as the first layout
	// starts (the graph is already interactive at that point).
	let loadPhase = $state("data");
	let loadError = $state(null);

	const nodes = $derived(graph ? graph.nodes : []);
	const links = $derived(graph ? graph.links : []);
	const teams = $derived(graph ? graph.teams : {});
	const maxGlobalDeg = $derived(graph ? graph.maxGlobalDeg : 1);
	const posByNode = new Map(); // last layout positions by node id (non-reactive; written by Graph)
	const matchPlayers = $derived(
		activeMatch ? new Set((activeMatch.competitors || []).flatMap((c) => c.roster || []).map((e) => e.playerId)) : null,
	);
	const matchTeamOf = $derived(
		activeMatch ? new Map((activeMatch.competitors || []).flatMap((c) => (c.roster || []).map((e) => [e.playerId, c.teamId]))) : null,
	);
	const view = $derived(
		visibleSubset(nodes, links, minW, maxW, minD, maxD, dateStart, dateEnd, posByNode, graph.playerTeamDates, matchPlayers, matchTeamOf),
	);

	const windowTotal = $derived.by(() => {
		if (!graph) return 0;
		return links.filter((l) =>
			l.dates.some((d) => (!dateStart || d >= dateStart) && (!dateEnd || d <= dateEnd)),
		).length;
	});

	const TURBO = [
		"#23171b",
		"#453390",
		"#4a52d4",
		"#4172f3",
		"#3491f8",
		"#29afeb",
		"#25cad4",
		"#2bdfb7",
		"#3af099",
		"#53fa7d",
		"#73fe64",
		"#96fa50",
		"#baf040",
		"#dae034",
		"#f3c92b",
		"#ffae25",
		"#ff9020",
		"#ff701a",
		"#eb5015",
		"#d0330e",
		"#b21c06",
		"#990e00",
		"#900d00",
	];
	const jerseyColor = (j) => (j == null || j < 1 || j > 23 ? "#8e8e93" : TURBO[j - 1]);
	const teamColor = (tid) => {
		if (tid == null) return "#8e8e93";
		const t = teams[tid];
		if (t && typeof t === "object" && t.color) return t.color;
		return "#8e8e93";
	};
	const selectedNode = $derived(selectedId != null ? view.nodes.find((n) => n.id === selectedId) : null);
	const selectedDeg = $derived(
		selectedId != null ? (view.nodes.find((n) => n.id === selectedId)?.deg ?? 0) : 0,
	);

 	const winRates = $derived(graph ? graph.winRates : {});
	const nodesById = $derived(new Map((nodes || []).map((n) => [n.id, n.name])));
	const playerName = (id) => nodesById.get(id) ?? "?";

	const partners = $derived.by(() => {
		if (!selectedNode) return [];
		return view.links
			.filter((l) => l.source.id === selectedId || l.target.id === selectedId)
			.sort((a, b) => b.w - a.w);
	});

	// Matches the selected player took part in, newest first. Uses the game
	// payload directly (competitors lists full rosters) so the par row shows
	// the player's own team, opposition, score and result regardless of any
	// edge focus.
	const playerMatches = $derived.by(() => {
		if (selectedId == null) return [];
		const id = selectedId;
		const out = [];
		for (const g of graph?.games || []) {
			const side = (g.competitors || []).find((c) => (c.roster || []).some((e) => e.playerId === id));
			if (!side) continue;
			const opp = (g.competitors || []).find((c) => c !== side);
			const my = side.score ?? null;
			const their = opp?.score ?? null;
			const row = {
				date: g.date,
				g,
				myTeamId: side.teamId,
				oppId: opp ? opp.teamId : null,
				home: Boolean(side.home),
				my: my,
				opp: their,
				winner: my != null && their != null && my > their ? side.teamId : opp && my != null && their != null && their > my ? opp.teamId : null,
			};
			out.push(row);
		}
		out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
		return out;
	});

	onMount(async () => {
		try {
			const text = await fetch("/data/graph.json").then((r) => r.text());
			graph = parseGraph(text);
			maxD = graph.maxGlobalDeg;
			const maxEW = graph.links.reduce((m, l) => Math.max(m, l.w), 0);
			maxWCap = Math.max(1, maxEW);
			maxW = maxWCap;
			const index = new Map();
			for (const g of graph.games || []) {
				let arr = index.get(g.date);
				if (!arr) index.set(g.date, (arr = []));
				arr.push(g);
			}
			gamesByDate = index;
			// Derive default date range: end at most recent date, start one year prior
			if (!dateStart && !dateEnd) {
				const allDates = [...new Set((graph.games || []).map((g) => g.date))];
				if (allDates.length) {
					const sorted = [...allDates].sort();
					const maxDate = sorted[sorted.length - 1];
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

	// Deselect the active node/edge. Keeps an open match so that closing the
	// player pane (or clicking the empty canvas / pressing Escape) while in
	// match view just clears the selection instead of exiting back to the full
	// graph. Match view is left explicitly: via its close button, by selecting
	// an edge, or by hitting Reset.
	function clearSelection() {
		selectedId = null;
		selectedEdge = null;
		hoveredTeammate = null;
	}
	function clearEdge() {
		selectedEdge = null;
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
		selectedEdge = null;
		hoveredTeammate = null;
		activeMatch = null;
		graphCmp?.forceRebuild();
	}
	function onGraphSelect(id) {
		selectedId = id;
		selectedEdge = null;
		hoveredTeammate = null;
	}
	// Clicking empty canvas while a match is open shuts it back down to the
	// filtered graph (and clears any selection). Match pane's own close button,
	// edge selection and Reset still work too.
	function onStageClick() {
		if (activeMatch != null) {
			activeMatch = null;
			selectedId = null;
		} else {
			clearSelection();
		}
	}
	function onEdgeSelect(edge) {
		selectedEdge = edge;
		hoveredTeammate = null;
		activeMatch = null;
	}
	// Focus a match: reduce the graph to its participants and show the match
	// pane. Deselect the currently active node/edge so the participant view
	// starts clean. Clicking the same match again is handled via the pane's
	// close button, not a toggle.
	function onMatchClick(game) {
		activeMatch = game;
		selectedId = null;
		selectedEdge = null;
		hoveredTeammate = null;
	}
	function onPartnerHover(id) {
		graphCmp?.hoverPartner(id);
		hoveredTeammate = id;
	}
	function onNodeHover(id) {
		hoveredTeammate = id != null ? Number(id) : null;
	}
	function onPartnerClick(l) {
		graphCmp?.selectEdge(l.source.id, l.target.id);
	}
	// The overlay only covers pre-render work: fetching data and building the
	// first graph. The moment the first layout starts, sigma has drawn the
	// graph and it is interactive even while FA2 keeps moving nodes — so the
	// overlay is dropped there, not when the layout finally settles.
	function onLayoutState({ running, first }) {
		if (!first) return;
		if (running) loadPhase = "ready";
	}
</script>

<svelte:window
	onclick={(ev) => {
		// Interacting with the toolbar (colour dropdowns, sliders, buttons)
		// must not drop the current node/edge selection; only clicks on the
		// empty graph area or outside the UI do.
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
		onTeamZoom={(tid) => graphCmp?.zoomToTeam(tid)}
		onEdgeAlpha={(lo, hi) => graphCmp?.setEdgeAlpha(lo, hi)}
		onEdgeColor={(mode) => graphCmp?.setEdgeColorMode(mode)}
		maxDeg={maxGlobalDeg}
		maxWCap={maxWCap}
		dateMin={graph ? graph.dateMin : null}
		dateMax={graph ? graph.dateMax : null}
	/>
	<Search {nodes} {teams} {selectedId} onPick={(d) => (selectedId = d.id)} />
<button class="btn" onclick={() => graphCmp?.fitToView()}>Recenter</button>
  <button class="btn" onclick={() => graphCmp?.forceRebuild()}>Rebuild Layout</button>
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
			{jerseyColor}
			{teamColor}
			prevPos={posByNode}
			{selectedId}
			{selectedEdge}
			{edgeColor}
			{alphaMin}
			{alphaMax}
			{winRates}
			{showEdges}
			{nodeColor}
			matchEventId={activeMatch?.eventId ?? null}
			onSelect={onGraphSelect}
			onStageClick={onStageClick}
			{onEdgeSelect}
			{onNodeHover}
			{onLayoutState}
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
			{onPartnerHover}
			{onPartnerClick}
			{hoveredTeammate}
			{onMatchClick}
			activeMatch={activeMatch?.eventId ?? null}
			onTeamZoom={(tid) => {
				clearSelection();
				graphCmp?.zoomToTeam(tid);
			}}
		/>
		<EdgeHud edge={selectedEdge} {gamesByDate} {teams} onClear={clearEdge} {onMatchClick} {activeMatch} />
		<MatchHud match={activeMatch} {teams} {playerName} {teamColor} onClose={() => (activeMatch = null)} onPick={onGraphSelect} />
	</div>
</div>
