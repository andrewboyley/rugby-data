<script>
  import { onMount } from "svelte";
  import * as d3 from "d3";

  let {
    viewNodes,
    viewLinks,
    maxGlobalDeg,
    params,
    color,
    selectedId,
    onSelect,
    onHover,
  } = $props();

  let svgEl;
  let sim, root, linkGroup, nodeGroup, labelGroup;
  let nodeSel, linkSel, labelSel;
  let curMaxW = 1;
  let width = window.innerWidth;
  let height = window.innerHeight - 48;

  onMount(() => {
    const svg = d3.select(svgEl)
      .attr("width", width)
      .attr("height", height);
    root = svg.append("g").attr("class", "root");
    linkGroup = root.append("g");
    nodeGroup = root.append("g");
    labelGroup = root.append("g");

    sim = d3.forceSimulation(viewNodes)
      .force("link", d3.forceLink(viewLinks).id((d) => d.id)
        .distance(params.dist)
        .strength((l) => params.str * (0.4 + 0.6 * (l.w / (curMaxW || 1)))))
      .force("charge", d3.forceManyBody().strength(params.chg))
      .force("x", d3.forceX(width / 2).strength(0.15))
      .force("y", d3.forceY(height / 2).strength(0.15))
      .force("collide", d3.forceCollide()
        .radius((d) => params.coll + Math.sqrt(d.app) * 1.0)
        .iterations(3))
      .alphaDecay(params.decay)
      .on("tick", ticked);

    const zoom = d3.zoom()
      .scaleExtent([0.1, 8])
      .filter((ev) => !ev.target.classList.contains("node"))
      .on("zoom", (ev) => root.attr("transform", ev.transform));
    svg.call(zoom).on("dblclick.zoom", null);

    window.addEventListener("resize", onResize);
    return () => {
      sim.stop();
      window.removeEventListener("resize", onResize);
    };
  });

  const drag = d3.drag()
    .on("start", (ev, d) => {
      if (!ev.active) sim.alphaTarget(0.3).restart();
      d.fx = d.x; d.fy = d.y;
    })
    .on("drag", (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
    .on("end", (ev, d) => {
      if (!ev.active) sim.alphaTarget(0);
      d.fx = null; d.fy = null;
    });

  function ticked() {
    if (!nodeSel) return;
    nodeSel.attr("cx", (d) => d.x).attr("cy", (d) => d.y)
      .attr("r", (d) => 3 + Math.sqrt(d.app) * 1.0);
    labelSel.attr("x", (d) => d.x + 5).attr("y", (d) => d.y + 3);
    linkSel.attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
  }

  function render() {
    const ns = viewNodes;
    const ls = viewLinks;
    curMaxW = d3.max(ls, (l) => l.w) || 1;

    sim.nodes(ns);
    sim.force("link").links(ls);
    sim.alpha(0.7).restart();

    linkSel = linkGroup.selectAll("line").data(
      ls, (d) => `${d.source.id}-${d.target.id}`);
    linkSel.exit().remove();
    linkSel = linkSel.enter().append("line").attr("stroke", "#5b6472")
      .merge(linkSel)
      .attr("stroke-width", (d) => 0.4 + 4.6 * Math.sqrt(d.w / curMaxW))
      .attr("stroke-opacity", 0.5);

    nodeSel = nodeGroup.selectAll("circle").data(ns, (d) => d.id);
    nodeSel.exit().remove();
    nodeSel = nodeSel.enter().append("circle")
      .attr("class", "node")
      .attr("r", 0)
      .call(drag)
      .merge(nodeSel)
      .attr("fill", (d) => color(d.deg / (maxGlobalDeg || 1)))
      .attr("stroke", "#0b0e13")
      .attr("stroke-width", 1)
      .on("mouseover", (ev, d) => onHover(d, ev.clientX, ev.clientY))
      .on("mousemove", (ev, d) => onHover(d, ev.clientX, ev.clientY))
      .on("mouseout", () => onHover(null))
      .on("click", (ev, d) => { ev.stopPropagation(); onSelect(d.id); });

    labelSel = labelGroup.selectAll("text").data(ns, (d) => d.id);
    labelSel.exit().remove();
    labelSel = labelSel.enter().append("text").attr("class", "node-label")
      .merge(labelSel)
      .text((d) => (d.deg > Math.floor(maxGlobalDeg / 3) ? d.name : ""))
      .style("display",
        (d) => (d.deg > Math.floor(maxGlobalDeg / 3) ? null : "none"));
  }

  // re-join when the visible subset changes
  $effect(() => {
    if (sim) render();
  });

  // apply force-parameter changes
  $effect(() => {
    if (!sim) return;
    sim.force("link").distance(params.dist)
      .strength((l) => params.str * (0.4 + 0.6 * (l.w / (curMaxW || 1))));
    sim.force("charge").strength(params.chg);
    sim.force("collide").radius((d) => params.coll + Math.sqrt(d.app) * 1.0);
    sim.force("x").strength(0.15);
    sim.force("y").strength(0.15);
    sim.alphaDecay(params.decay);
    sim.alpha(0.8).restart();
  });

  // highlight a selected player and dim the rest
  $effect(() => {
    if (!nodeSel) return;
    const id = selectedId;
    if (id == null) {
      nodeSel.classed("dim", false)
        .attr("stroke", "#0b0e13").attr("stroke-width", 1);
      linkSel.classed("dim", false)
        .attr("stroke", "#5b6472")
        .attr("stroke-width", (d) => 0.4 + 4.6 * Math.sqrt(d.w / (curMaxW || 1)))
        .attr("stroke-opacity", 0.5);
      return;
    }
    const sel = viewNodes.find((n) => n.id === id);
    if (!sel) return;
    const keep = new Set([id]);
    for (const l of viewLinks) {
      if (l.source.id === id) keep.add(l.target.id);
      if (l.target.id === id) keep.add(l.source.id);
    }
    nodeSel.classed("dim", true).attr("stroke", "#0b0e13")
      .attr("stroke-width", 1);
    linkSel.classed("dim", true);
    nodeSel.filter((n) => keep.has(n.id)).classed("dim", false);
    linkSel.filter((l) => keep.has(l.source.id) && keep.has(l.target.id))
      .classed("dim", false)
      .attr("stroke", "#ffd166")
      .attr("stroke-width", (l) => 1 + 5 * Math.sqrt(l.w / (curMaxW || 1)))
      .attr("stroke-opacity", 0.9);
    nodeSel.filter((n) => n.id === id)
      .attr("stroke", "#ffd166").attr("stroke-width", 2.5);
  });

  function onResize() {
    width = window.innerWidth;
    height = window.innerHeight - 48;
    d3.select(svgEl).attr("width", width).attr("height", height);
    sim.force("x").x(width / 2);
    sim.force("y").y(height / 2);
  }
</script>

<svg class="graph" bind:this={svgEl}></svg>
