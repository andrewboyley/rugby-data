<script>
	import { onMount } from "svelte";
	import { parseGraph, visibleSubset } from "./lib.js";
	import Controls from "./Controls.svelte";
	import Search from "./Search.svelte";
	import Hud from "./Hud.svelte";
	import EdgeHud from "./EdgeHud.svelte";

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
	let gamesByDate = $state(new Map());
	let edgeColor = $state("winrate");
	let alphaMin = $state(0.05);
	let alphaMax = $state(0.6);
	let nodeColor = $state("team");
	let showEdges = $state(false);
	let graphCmp = $state(null);

	const nodes = $derived(graph ? graph.nodes : []);
	const links = $derived(graph ? graph.links : []);
	const teams = $derived(graph ? graph.teams : {});
	const maxGlobalDeg = $derived(graph ? graph.maxGlobalDeg : 1);
	const posByNode = new Map(); // last layout positions by node id (non-reactive; written by Graph)
	const view = $derived(
		visibleSubset(nodes, links, minW, maxW, minD, maxD, dateStart, dateEnd, posByNode, graph.playerTeamDates),
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

	const partners = $derived.by(() => {
		if (!selectedNode) return [];
		return view.links
			.filter((l) => l.source.id === selectedId || l.target.id === selectedId)
			.sort((a, b) => b.w - a.w)
			.slice(0, 12);
	});

	onMount(async () => {
		const text = await fetch("/data/graph.json").then((r) => r.text());
		graph = parseGraph(text);
		maxD = graph.maxGlobalDeg;
		const maxEW = graph.links.reduce((m, l) => Math.max(m, l.w), 0);
		maxWCap = Math.max(1, maxEW);
		maxW = maxWCap;
		const index = new Map();
		for (const g of graph.games || []) {
			index.set(g.date, g);
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
	});

	function clearSelection() {
		selectedId = null;
		selectedEdge = null;
	}
	function clearEdge() {
		selectedEdge = null;
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
		graphCmp?.forceRebuild();
	}
	function onGraphSelect(id) {
		selectedId = id;
		selectedEdge = null;
	}
	function onEdgeSelect(edge) {
		selectedEdge = edge;
	}
	function onPartnerHover(id) {
		graphCmp?.hoverPartner(id);
	}
	function onPartnerClick(l) {
		graphCmp?.selectEdge(l.source.id, l.target.id);
	}
</script>

<svelte:window
	onclick={(ev) => {
		// Interacting with the toolbar (colour dropdowns, sliders, buttons)
		// must not drop the current node/edge selection; only clicks on the
		// empty graph area or outside the UI do.
		if (ev.target instanceof Element && !ev.target.closest(".graph-host, .search-wrap, #hud, #edge-hud, header"))
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
  <button class="btn" onclick={() => (showEdges = !showEdges)}>{showEdges ? "Hide Edges" : "Show Edges"}</button>
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
			onSelect={onGraphSelect}
			{onEdgeSelect}
		/>
	{/await}

	<div id="panels">
		<Hud
			node={selectedNode}
			deg={selectedDeg}
			{partners}
			{teams}
			onClear={clearSelection}
			{onPartnerHover}
			{onPartnerClick}
			onTeamZoom={(tid) => {
				clearSelection();
				graphCmp?.zoomToTeam(tid);
			}}
		/>
		<EdgeHud edge={selectedEdge} {gamesByDate} {teams} onClear={clearEdge} />
	</div>
</div>
