<script>
	import { onMount } from "svelte";
	import { parseGraph, visibleSubset, edgeKey } from "./lib.js";
	import Graph from "./Graph.svelte";
	import Controls from "./Controls.svelte";
	import Search from "./Search.svelte";
	import Hud from "./Hud.svelte";
	import EdgeHud from "./EdgeHud.svelte";

	let graph = $state(null);
	let minW = $state(1);
	let maxW = $state(45);
	let maxD = $state(90);
	let team = $state(null);
	let dateStart = $state(null);
	let dateEnd = $state(null);
	let selectedId = $state(null);
	let selectedEdge = $state(null);
	let defaultDateStart = $state(null);
	let defaultDateEnd = $state(null);
	let gamesByDate = $state(new Map());
	let edgeColor = $state("none");
	let graphCmp;

	const nodes = $derived(graph ? graph.nodes : []);
	const links = $derived(graph ? graph.links : []);
	const teams = $derived(graph ? graph.teams : {});
	const maxGlobalDeg = $derived(graph ? graph.maxGlobalDeg : 1);
	const posByNode = new Map(); // last layout positions by node id (non-reactive; written by Graph)
	const view = $derived(
		visibleSubset(nodes, links, minW, maxW, maxD, team, dateStart, dateEnd, posByNode),
	);

	const windowTotal = $derived.by(() => {
		if (!graph) return 0;
		return links.filter((l) => {
			if (team != null && (l.source.team !== team || l.target.team !== team)) {
				return false;
			}
			return l.dates.some((d) => (!dateStart || d >= dateStart) && (!dateEnd || d <= dateEnd));
		}).length;
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
	const selectedNode = $derived(selectedId != null ? nodes.find((n) => n.id === selectedId) : null);
	const selectedDeg = $derived(
		selectedId != null ? (view.nodes.find((n) => n.id === selectedId)?.deg ?? 0) : 0,
	);

	const winRates = $derived.by(() => {
		const m = new Map();
		if (edgeColor !== "winrate" || !gamesByDate) return m;
		for (const l of view.links) {
			if (!l.dates.length) continue;
			const id = l.source.id;
			let wins = 0;
			let n = 0;
			for (const d of l.dates) {
				const g = gamesByDate.get(d);
				if (!g) continue;
				const side = g.competitors.find((c) => c.roster?.some((p) => p.playerId === id));
				if (!side) continue;
				const opp = g.competitors.find((c) => c !== side);
				if (!opp) continue;
				n++;
				if (side.score > opp.score) wins++;
			}
			if (n) m.set(edgeKey(l.source.id, l.target.id), wins / n);
		}
		return m;
	});

	const partners = $derived.by(() => {
		if (!selectedNode) return [];
		return view.links
			.filter((l) => l.source.id === selectedId || l.target.id === selectedId)
			.sort((a, b) => b.w - a.w)
			.slice(0, 12);
	});

	onMount(async () => {
		const text = await fetch("/data/graph.gexf").then((r) => r.text());
		graph = parseGraph(text);
		maxD = graph.maxGlobalDeg;
		defaultDateStart = graph.dateMin || null;
		defaultDateEnd = graph.dateMax || null;
		dateStart = defaultDateStart;
		dateEnd = defaultDateEnd;
		try {
			const data = await fetch("/data/dataset.json").then((r) => r.json());
			const index = new Map();
			for (const g of data.games || []) {
				index.set(g.date.slice(0, 10), g);
			}
			gamesByDate = index;
		} catch {
			/* edge pane falls back to date-only rows */
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
		maxW = 45;
		maxD = graph ? graph.maxGlobalDeg : 90;
		team = null;
		dateStart = defaultDateStart;
		dateEnd = defaultDateEnd;
		selectedId = null;
		selectedEdge = null;
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
		if (!ev.target.closest(".graph-host, .search-wrap, #hud, #edge-hud")) clearSelection();
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
		bind:maxD
		bind:team
		bind:dateStart
		bind:dateEnd
		bind:edgeColor
		{teams}
		maxDeg={maxGlobalDeg}
		dateMin={defaultDateStart}
		dateMax={defaultDateEnd}
	/>
	<Search {nodes} {teams} onPick={(d) => (selectedId = d.id)} />
	<button class="btn" onclick={() => graphCmp?.fitToView()}>Recenter</button>
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

<div id="panels">
	<Hud
		node={selectedNode}
		deg={selectedDeg}
		{partners}
		{teams}
		onClear={clearSelection}
		{onPartnerHover}
		{onPartnerClick}
	/>
	<EdgeHud edge={selectedEdge} {gamesByDate} {teams} onClear={clearEdge} />
</div>

<Graph
	bind:this={graphCmp}
	viewNodes={view.nodes}
	viewLinks={view.links}
	{teams}
	{jerseyColor}
	prevPos={posByNode}
	{selectedId}
	{selectedEdge}
	{edgeColor}
	{winRates}
	onSelect={onGraphSelect}
	{onEdgeSelect}
/>
