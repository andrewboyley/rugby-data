<script>
  import { onMount } from "svelte";
  import { scaleSequential, interpolateTurbo } from "d3";
  import { parseGraph, visibleSubset } from "./lib.js";
  import Graph from "./Graph.svelte";
  import Controls from "./Controls.svelte";
  import Search from "./Search.svelte";
  import Hud from "./Hud.svelte";
  import ForcePanel from "./ForcePanel.svelte";

  let graph = $state(null);
  let minW = $state(1);
  let maxD = $state(90);
  let team = $state(null);
  let selectedId = $state(null);
  let hover = $state(null); // { node, x, y }
  let showParams = $state(false);
  let params = $state({ dist: 120, str: 0.4, chg: -600, coll: 8, decay: 0.02 });

  const nodes = $derived(graph ? graph.nodes : []);
  const links = $derived(graph ? graph.links : []);
  const teams = $derived(graph ? graph.teams : {});
  const maxGlobalDeg = $derived(graph ? graph.maxGlobalDeg : 1);
  const view = $derived(visibleSubset(nodes, links, minW, maxD, team));

  const color = scaleSequential(interpolateTurbo).domain([0, 1]);

  const selectedNode = $derived(
    selectedId != null ? nodes.find((n) => n.id === selectedId) : null);
  const selectedDeg = $derived(
    selectedId != null
      ? (view.nodes.find((n) => n.id === selectedId)?.deg ?? 0)
      : 0);

  const partners = $derived.by(() => {
    if (!selectedNode) return [];
    return view.links
      .filter((l) => l.source.id === selectedId || l.target.id === selectedId)
      .sort((a, b) => b.w - a.w)
      .slice(0, 12);
  });

  onMount(async () => {
    const g = await fetch("/data/graph.json").then((r) => r.json());
    graph = parseGraph(g);
    maxD = graph.maxGlobalDeg;
  });

  function clearSelection() {
    selectedId = null;
  }
  function onGraphSelect(id) {
    selectedId = id;
  }
  function onHover(d, x, y) {
    hover = d ? { node: d, x, y } : null;
  }
  function applyParams(p) {
    params = p;
  }
</script>

<svelte:window
  onclick={(ev) => {
    if (!ev.target.closest(".node, .search-wrap, #hud")) clearSelection();
  }}
  onkeydown={(ev) => {
    if (ev.key === "Escape") clearSelection();
  }} />

<header>
  <h1>Rugby co-occurrence graph</h1>
  <div id="stats">
    {#if graph}
      {view.nodes.length} players &middot; {view.links.length} edges
      (of {links.length}) &middot; max degree {maxGlobalDeg}
    {:else}
      loading…
    {/if}
  </div>
  <Controls bind:minW bind:maxD bind:team {teams} maxDeg={maxGlobalDeg} />
  <Search {nodes} {teams} onPick={(d) => (selectedId = d.id)} />
  <button class="btn" onclick={() => (showParams = !showParams)}>
    {showParams ? "Hide params" : "Force params"}
  </button>
</header>

<ForcePanel {params} show={showParams} onApply={applyParams} />

<div id="legend">
  <div><span class="sw" style="background:#5ac8fa"></span>node = player, size = appearances</div>
  <div><span class="sw" style="background:#8e8e93"></span>edge = shared match, width = co-occurrences</div>
  <div>color: <span style="color:#5ac8fa">■</span> few matches &nbsp; <span style="color:#ff2d55">■</span> many</div>
</div>

{#if hover}
  <div class="tip" style="left:{hover.x + 14}px; top:{hover.y + 14}px">
    <b>{hover.node.name}</b> &middot; {hover.node.app} appearances,
    {hover.node.deg} teammates
  </div>
{/if}

<Hud node={selectedNode} deg={selectedDeg} {partners} {teams} onClear={clearSelection} />

<Graph
  viewNodes={view.nodes}
  viewLinks={view.links}
  {maxGlobalDeg}
  {params}
  {color}
  selectedId={selectedId}
  onSelect={onGraphSelect}
  onHover={onHover}
/>
