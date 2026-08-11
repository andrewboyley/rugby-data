<script>
  import { onMount } from "svelte";
  import * as d3 from "d3";

  let {
    viewNodes,
    viewLinks,
    maxGlobalDeg,
    teams,
    params,
    color,
    selectedId,
    onSelect,
    onHover,
  } = $props();

  let svgEl;
  let zoom, root, linkGroup, nodeGroup, labelGroup, clusterGroup;
  let nodeSel, linkSel, labelSel, clusterSel;
  let curMaxW = 1;
  let width = window.innerWidth;
  let height = window.innerHeight - 48;
  let worker;
  let curIds = [];
  let curX = new Float64Array(0);
  let curY = new Float64Array(0);
  let curIdIdx = new Map();
  let elArr = [];
  let labelEls = [];
  let linkEls = [];
  let clusterEls = [];
  let teamArr = new Int16Array(0);
  let clusterCent = new Map(); // team id -> {x, y} centroid in graph space
  let zoomK = 1;
  let tickCount = 0;

  onMount(() => {
    const svg = d3.select(svgEl)
      .attr("width", width)
      .attr("height", height);
    root = svg.append("g").attr("class", "root");
    linkGroup = root.append("g");
    nodeGroup = root.append("g");
    labelGroup = root.append("g");
    clusterGroup = root.append("g").attr("class", "cluster");

    zoom = d3.zoom()
      .scaleExtent([0.1, 8])
      .filter((ev) => !ev.target.classList.contains("node"))
      .on("zoom", (ev) => {
        zoomK = ev.transform.k;
        root.attr("transform", ev.transform);
        placeClusters();
      });
    svg.call(zoom).on("dblclick.zoom", null);

    worker = new Worker(new URL("./sim-worker.js", import.meta.url),
      { type: "module" });
    worker.onmessage = (e) => applyTick(e.data);

    window.addEventListener("resize", onResize);
    render();
    return () => {
      worker.terminate();
      window.removeEventListener("resize", onResize);
    };
  });

  function render() {
    const ns = viewNodes;
    const ls = viewLinks;
    curMaxW = d3.max(ls, (l) => l.w) || 1;

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
      .merge(nodeSel)
      .attr("fill", (d) => color(d.deg / (maxGlobalDeg || 1)))
      .attr("stroke", "#0b0e13")
      .attr("stroke-width", 1)
      .attr("r", (d) => 3 + Math.sqrt(d.app) * 1.0)
      .attr("cx", (d) => d.x || 0)
      .attr("cy", (d) => d.y || 0)
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
        (d) => (d.deg > Math.floor(maxGlobalDeg / 3) ? null : "none"))
      .attr("x", (d) => (d.x || 0) + 5)
      .attr("y", (d) => (d.y || 0) + 3);

    curIds = ns.map((n) => n.id);
    curIdIdx = new Map(curIds.map((id, i) => [id, i]));
    curX = new Float64Array(ns.length);
    curY = new Float64Array(ns.length);
    elArr = new Array(ns.length);
    nodeSel.each(function (d) { elArr[curIdIdx.get(d.id)] = this; });
    const labelCut = Math.floor(maxGlobalDeg / 3);
    labelEls = [];
    labelSel.each(function (d) {
      if (d.deg > labelCut) labelEls.push({ el: this, idx: curIdIdx.get(d.id) });
    });
    linkEls = [];
    linkSel.each(function (d) {
      linkEls.push({ el: this, sid: d.source.id, tid: d.target.id });
    });

    // team cluster labels at the centroid of each team's visible nodes
    teamArr = new Int16Array(ns.length);
    const tsumX = new Map(), tsumY = new Map(), tcount = new Map();
    for (let i = 0; i < ns.length; i++) {
      const t = ns[i].team;
      teamArr[i] = t == null ? -1 : t;
      if (t == null) continue;
      tsumX.set(t, (tsumX.get(t) || 0) + (ns[i].x || 0));
      tsumY.set(t, (tsumY.get(t) || 0) + (ns[i].y || 0));
      tcount.set(t, (tcount.get(t) || 0) + 1);
    }
    const teamDatums = [...tcount]
      .filter(([, c]) => c >= 2)
      .map(([tid, c]) => ({
        tid,
        name: teams[tid] || `team ${tid}`,
        cx: (tsumX.get(tid) || 0) / c,
        cy: (tsumY.get(tid) || 0) / c,
      }));
    clusterCent.clear();
    for (const d of teamDatums) clusterCent.set(d.tid, { x: d.cx, y: d.cy });
    clusterSel = clusterGroup.selectAll("text").data(teamDatums, (d) => d.tid);
    clusterSel.exit().remove();
    clusterSel = clusterSel.enter().append("text").attr("class", "cluster-label")
      .attr("dy", "0.35em")
      .merge(clusterSel)
      .text((d) => d.name);
    clusterEls = [];
    clusterSel.each(function (d) { clusterEls.push({ el: this, tid: d.tid }); });
    placeClusters();

    if (!worker) return;
    worker.postMessage({
      type: "update",
      nodes: ns.map((n) => ({ id: n.id, app: n.app, x: n.x, y: n.y })),
      links: ls.map((l) => ({ source: l.source.id, target: l.target.id, w: l.w })),
      curMaxW,
      dist: params.dist, str: params.str, chg: params.chg,
      coll: params.coll, decay: params.decay,
      alpha: 0.15,
    });
  }

  function applyTick(msg) {
    if (msg.type !== "tick") return;
    const pos = msg.pos;
    const n = curIds.length;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 2], y = pos[i * 2 + 1];
      curX[i] = x;
      curY[i] = y;
      const el = elArr[i];
      if (el) { el.setAttribute("cx", x); el.setAttribute("cy", y); }
    }
    if (++tickCount % 3 === 0) {
      for (const { el, sid, tid } of linkEls) {
        const a = curIdIdx.get(sid), b = curIdIdx.get(tid);
        if (a == null || b == null) continue;
        el.setAttribute("x1", curX[a]); el.setAttribute("y1", curY[a]);
        el.setAttribute("x2", curX[b]); el.setAttribute("y2", curY[b]);
      }
      for (const { el, idx } of labelEls) {
        el.setAttribute("x", curX[idx] + 5);
        el.setAttribute("y", curY[idx] + 3);
      }
      const sx = new Map(), sy = new Map(), sc = new Map();
      for (let i = 0; i < n; i++) {
        const t = teamArr[i];
        if (t < 0) continue;
        sx.set(t, (sx.get(t) || 0) + curX[i]);
        sy.set(t, (sy.get(t) || 0) + curY[i]);
        sc.set(t, (sc.get(t) || 0) + 1);
      }
      clusterCent.clear();
      for (const { tid } of clusterEls) {
        const c = sc.get(tid);
        if (c) clusterCent.set(tid, { x: sx.get(tid) / c, y: sy.get(tid) / c });
      }
      placeClusters();
    }
  }

  function placeClusters() {
    const s = 1 / zoomK;
    for (const { el, tid } of clusterEls) {
      const c = clusterCent.get(tid);
      if (!c) continue;
      el.setAttribute("transform", `translate(${c.x},${c.y}) scale(${s})`);
    }
  }

  // re-join when the visible subset changes
  $effect(() => {
    if (worker) render();
  });

  // push force-parameter changes to the worker
  $effect(() => {
    if (!worker) return;
    worker.postMessage({
      type: "params",
      dist: params.dist, str: params.str, chg: params.chg,
      coll: params.coll, decay: params.decay,
    });
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
    if (worker) worker.postMessage({ type: "size", width, height });
  }

  // Fit the zoom transform so every visible node is centred in the viewport.
  export function fitToView() {
    if (!svgEl || !zoom || !viewNodes.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const d of viewNodes) {
      const i = curIdIdx.get(d.id);
      const x = i != null ? curX[i] : d.x;
      const y = i != null ? curY[i] : d.y;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    const dx = x1 - x0 || 1;
    const dy = y1 - y0 || 1;
    const pad = 80;
    const scale = Math.min(
      (width - pad * 2) / dx, (height - pad * 2) / dy, 2);
    const tx = width / 2 - scale * ((x0 + x1) / 2);
    const ty = height / 2 - scale * ((y0 + y1) / 2);
    const t = d3.zoomIdentity.translate(tx, ty).scale(scale);
    d3.select(svgEl).transition().duration(400).call(zoom.transform, t);
  }
</script>

<svg class="graph" bind:this={svgEl}></svg>
