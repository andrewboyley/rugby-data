<script>
	import { onDestroy } from "svelte";
	import Sigma from "sigma";
	import Graph from "graphology";
	import { fitViewportToNodes } from "@sigma/utils";
	import forceAtlas2 from "graphology-layout-forceatlas2";
	import FA2Layout from "graphology-layout-forceatlas2/worker";
	import { NodeBorderProgram, createNodeBorderProgram } from "@sigma/node-border";
	import { edgeKey, winRateColor } from "./lib.js";

	const ActiveBorderProgram = createNodeBorderProgram({
		borders: [
			{ color: { value: "#000000" }, size: { value: 2.5, mode: "pixels" } },
			{ color: { value: "#ffffff" }, size: { value: 5, mode: "pixels" } },
			{ color: { value: "#000000" }, size: { value: 2.5, mode: "pixels" } },
			{ color: { attribute: "color" }, size: { fill: true } },
		],
	});

	let {
		viewNodes,
		viewLinks,
		teams,
		jerseyColor,
		prevPos,
		selectedId,
		selectedEdge,
		onSelect,
		onEdgeSelect = () => {},
		edgeColor = "none",
		winRates = new Map(),
	} = $props();

	let host;
	let sigma = null;
	let graph = null;
	let layout = null;
	let clusterLayer = null;
	const clusterDivs = new Map();

	let hoveredId = null;
	let hoverNeighbors = new Set();
	let hoveredOther = null;
	let pinnedId = null;
	let pinnedNeighbors = new Set();
	let hoveredEdge = null;
	let pinnedEdge = null;
	let tip = $state({ x: 0, y: 0, visible: false, text: "" });

	const focusId = () => hoveredId ?? pinnedId;
	const focusNeighbors = () => (hoveredId != null ? hoverNeighbors : pinnedNeighbors);

	function isActiveEdge(edge) {
		if (pinnedId == null) return false;
		const [a, b] = graph.extremities(edge);
		return (a === pinnedId && pinnedNeighbors.has(b)) || (b === pinnedId && pinnedNeighbors.has(a));
	}

	function nodeReducer(node, data) {
		const res = { ...data };
		const f = focusId();
		const isHovered = node === hoveredId || node === hoveredOther;
		const isActive = node === f;
		const isSecondary = f != null && focusNeighbors().has(node);

		res.isActive = isActive;
		res.isSecondary = isSecondary;
		res.isHovered = isHovered;

		if (f != null) {
			if (isActive) {
				res.type = "activeBorder";
				res.forceLabel = true;
			} else if (hoveredOther != null && node === hoveredOther) {
				res.type = "border";
				res.borderColor = "#8ab4f8";
				res.forceLabel = true;
				res.color = "#8ab4f8";
			} else if (isSecondary) {
				res.type = "border";
				res.borderColor = "#000000";
				res.forceLabel = true;
			} else {
				res.type = "border";
				res.borderColor = "#000000";
				res.label = "";
				res.color = "#39434f";
			}
		} else {
			res.type = "border";
			res.borderColor = "#000000";
			if (isHovered) {
				res.forceLabel = true;
			}
		}
		return res;
	}

	function edgeReducer(edge, data) {
		const res = { ...data };
		if (pinnedId != null) {
			const [a, b] = graph.extremities(edge);
			const joinsPinned =
				(a === pinnedId && pinnedNeighbors.has(b)) || (b === pinnedId && pinnedNeighbors.has(a));
			const joinsHoveredOther =
				hoveredOther != null &&
				a !== b &&
				((a === pinnedId && b === hoveredOther) || (b === pinnedId && a === hoveredOther));
			if (edge === pinnedEdge) {
				res.color = "#7db4ff";
				res.size = (res.size || 0.5) * 1.6;
			} else if (edge === hoveredEdge) {
				res.color = "#7db4ff";
			} else if (joinsHoveredOther) {
				res.color = "#8ab4f8";
			} else if (joinsPinned) {
				// keep global edge style
			} else {
				res.hidden = true;
			}
			return res;
		}
		if (pinnedEdge != null && edge === pinnedEdge) {
			res.color = "#7db4ff";
			return res;
		}
		if (pinnedEdge != null) {
			res.hidden = true;
			return res;
		}
		if (pinnedEdge != null && edge === pinnedEdge) {
			res.color = "#7db4ff";
			return res;
		}
		if (hoveredEdge != null && edge === hoveredEdge) {
			res.size = (res.size || 0.5) * 1.6;
		}
		const f = focusId();
		if (f == null) return { ...data };
		const [a, b] = graph.extremities(edge);
		const adjacent = (a === f && focusNeighbors().has(b)) || (b === f && focusNeighbors().has(a));
		if (!adjacent) res.hidden = true;
		return res;
	}

	// ---- graph building ----
	function nodeSize(n, maxApp) {
		return 2.5 + 5 * Math.sqrt((n.app || 0) / maxApp);
	}
	function edgeSize(w, maxW) {
		return 0.4 + 4.6 * Math.sqrt(w / maxW);
	}

	function buildGraph(nodes, links) {
		const g = new Graph();
		const maxApp = Math.max(1, ...nodes.map((n) => n.app || 0));
		const maxW = Math.max(1, ...links.map((l) => l.w));
		for (const n of nodes) {
			const p = prevPos?.get(n.id);
			g.addNode(String(n.id), {
				label: n.name,
				color: jerseyColor(n.jersey),
				type: "border",
				borderColor: "#000000",
				size: nodeSize(n, maxApp),
				x: p?.x ?? Math.random() * 4 - 2,
				y: p?.y ?? Math.random() * 4 - 2,
				name: n.name,
				team: n.team,
				jersey: n.jersey,
				app: n.app,
				deg: n.deg,
			});
		}
		for (const l of links) {
			const wr = edgeColor === "winrate" ? winRates.get(edgeKey(l.source.id, l.target.id)) : null;
			g.addEdge(String(l.source.id), String(l.target.id), {
				weight: l.w,
				size: edgeSize(l.w, maxW),
				w: l.w,
				dates: l.dates || [],
				...(wr != null ? { color: winRateColor(wr) } : {}),
			});
		}
		return g;
	}

	function createSigma() {
		const s = new Sigma(graph, host, {
			labelColor: { color: "#d6dbe2" },
			defaultEdgeColor: "#5a6572",
			enableEdgeEvents: true,
			nodeProgramClasses: {
				border: NodeBorderProgram,
				activeBorder: ActiveBorderProgram,
			},
			defaultDrawNodeLabel: (context, data, settings) => {
				if (!data.label) return;
				const fontSize = settings.labelSize;
				const font = settings.labelFont;
				context.font = `${settings.labelWeight || ""} ${fontSize}px ${font}`;

				const x = data.x + data.size + 4;
				const y = data.y + fontSize / 3;

				context.strokeStyle = "#000000";
				context.lineWidth = 3;
				context.strokeText(data.label, x, y);

				context.fillStyle = data.isHovered ? "#000000" : settings.labelColor.color;
				context.fillText(data.label, x, y);
			},
			nodeReducer,
			edgeReducer,
		});
		window.__sigma = s;
		window.__graph = graph;

		s.on("clickNode", ({ node }) => {
			const clickedId = Number(node);
			if (selectedId != null) {
				if (clickedId === Number(selectedId)) {
					onSelect(null);
					return;
				}
				const edge =
					graph.edge(String(selectedId), String(clickedId)) ??
					graph.edge(String(clickedId), String(selectedId));
				if (edge != null) {
					if (selectedEdge?.key === edge) {
						onSelect(clickedId);
					} else {
						const s_ext = graph.extremities(edge);
						const attrs = graph.getEdgeAttributes(edge);
						onEdgeSelect({
							key: edge,
							a: graph.getNodeAttribute(s_ext[0], "name"),
							b: graph.getNodeAttribute(s_ext[1], "name"),
							team: graph.getNodeAttribute(s_ext[0], "team"),
							w: attrs.w,
							dates: attrs.dates || [],
						});
					}
					return;
				}
			}
			onSelect(clickedId);
		});
		s.on("clickStage", () => onSelect(null));
		s.on("clickEdge", ({ edge }) => {
			if (!isActiveEdge(edge)) return;
			const attrs = graph.getEdgeAttributes(edge);
			const [a, b] = graph.extremities(edge);
			onEdgeSelect({
				key: edge,
				a: graph.getNodeAttribute(String(a), "name"),
				b: graph.getNodeAttribute(String(b), "name"),
				team: graph.getNodeAttribute(String(a), "team"),
				w: attrs.w,
				dates: attrs.dates || [],
			});
		});
		s.on("enterEdge", ({ edge }) => {
			hoveredEdge = edge;
			s.refresh({ skipIndexation: true });
		});
		s.on("leaveEdge", () => {
			hoveredEdge = null;
			s.refresh({ skipIndexation: true });
		});
		s.on("enterNode", ({ node, event }) => {
			if (pinnedId != null) {
				hoveredOther = node;
				const e = graph.edge(pinnedId, node);
				if (e != null) {
					tip = {
						x: event.x,
						y: event.y,
						visible: true,
						text: `${graph.getEdgeAttribute(e, "w")} shared games`,
					};
				}
			} else {
				hoveredId = node;
				hoverNeighbors = new Set(graph.neighbors(node));
			}
			s.refresh({ skipIndexation: true });
			window.__hover = { hoveredId, hoveredOther, neighbors: hoverNeighbors.size };
		});
		s.on("leaveNode", () => {
			hoveredId = null;
			hoveredOther = null;
			hoverNeighbors = new Set();
			tip = { x: 0, y: 0, visible: false, text: "" };
			s.refresh({ skipIndexation: true });
			window.__hover = { hoveredId: null, neighbors: 0 };
		});
		s.on("afterRender", () => updateClusters());

		clusterLayer = s.createLayer("clusters", "div");
		clusterLayer.style.pointerEvents = "none";
		return s;
	}

	// ---- cluster labels (HTML overlay) ----
	function updateClusters() {
		if (!sigma || !clusterLayer || !graph) return;
		const groups = new Map();
		graph.forEachNode((key, a) => {
			if (a.team == null) return;
			let g = groups.get(a.team);
			if (!g) {
				g = { sx: 0, sy: 0, n: 0, name: teams[a.team] || `team ${a.team}` };
				groups.set(a.team, g);
			}
			g.sx += a.x;
			g.sy += a.y;
			g.n++;
		});
		for (const [tid] of groups) {
			if (!clusterDivs.has(tid)) {
				const d = document.createElement("div");
				d.className = "sigma-cluster";
				clusterLayer.appendChild(d);
				clusterDivs.set(tid, d);
			}
		}
		for (const [tid, d] of clusterDivs) {
			const g = groups.get(tid);
			if (!g) {
				d.style.display = "none";
				continue;
			}
			const p = sigma.graphToViewport({ x: g.sx / g.n, y: g.sy / g.n });
			d.style.display = "block";
			d.style.left = `${p.x}px`;
			d.style.top = `${p.y}px`;
			d.textContent = g.name;
		}
	}

	function resetClusters() {
		if (!clusterLayer) return;
		for (const d of clusterDivs.values()) d.remove();
		clusterDivs.clear();
		updateClusters();
	}

	// ---- layout ----
	function restartLayout() {
		if (layout) layout.kill();
		layout = new FA2Layout(graph, {
			settings: {
				...forceAtlas2.inferSettings(graph),
				gravity: 0.3,
			},
		});
		layout.start();
	}

	function onLayoutStep() {
		if (!graph) return;
	}

	// ---- lifecycle ----
	let graphStepHandler = null;
	function bindLayoutListener() {
		if (graphStepHandler) graph.removeListener("eachNodeAttributesUpdated", graphStepHandler);
		graphStepHandler = onLayoutStep;
		graph.on("eachNodeAttributesUpdated", graphStepHandler);
	}

	function rebuild(vn, vl) {
		if (layout) {
			layout.kill();
			layout = null;
		}
		if (graphStepHandler) graph.removeListener("eachNodeAttributesUpdated", graphStepHandler);
		graphStepHandler = null;
		graph = buildGraph(vn, vl);
		if (!sigma) {
			sigma = createSigma();
		} else {
			sigma.setGraph(graph);
		}
		bindLayoutListener();
		hoveredId = null;
		hoverNeighbors = new Set();
		hoveredOther = null;
		pinnedId = null;
		pinnedNeighbors = new Set();
		hoveredEdge = null;
		pinnedEdge = null;
		tip = { x: 0, y: 0, visible: false, text: "" };
		resetClusters();
		restartLayout();
	}

	$effect(() => {
		const vn = viewNodes;
		const vl = viewLinks;
		if (!vn || !host) return;
		rebuild(vn, vl);
	});

	$effect(() => {
		const sel = selectedId;
		if (sigma && graph) {
			if (sel != null && graph.hasNode(String(sel))) {
				pinnedId = String(sel);
				pinnedNeighbors = new Set(graph.neighbors(String(sel)));
			} else {
				pinnedId = null;
				pinnedNeighbors = new Set();
			}
			pinnedEdge = selectedEdge?.key && graph.hasEdge(selectedEdge.key) ? selectedEdge.key : null;
			sigma.refresh({ skipIndexation: true });
		}
		window.__sel = { selectedId, hasSigma: !!sigma };
	});

	onDestroy(() => {
		if (layout) layout.kill();
		if (sigma) sigma.kill();
	});

	export function fitToView() {
		if (sigma && graph && graph.order > 0) {
			fitViewportToNodes(sigma, graph.nodes(), { animate: true });
		}
	}

	export function hoverPartner(nodeId) {
		if (!graph) return;
		hoveredOther = nodeId != null ? String(nodeId) : null;
		if (sigma) sigma.refresh({ skipIndexation: true });
	}

	export function selectEdge(sourceId, targetId) {
		if (!sigma || !graph) return;
		const source = String(sourceId);
		const target = String(targetId);
		const edge = graph.edge(source, target) ?? graph.edge(target, source);
		if (edge == null) return;
		const s = graph.extremities(edge);
		const attrs = graph.getEdgeAttributes(edge);
		onEdgeSelect({
			key: edge,
			a: graph.getNodeAttribute(s[0], "name"),
			b: graph.getNodeAttribute(s[1], "name"),
			team: graph.getNodeAttribute(s[0], "team") ?? graph.getNodeAttribute(s[1], "team"),
			w: attrs.w,
			dates: attrs.dates || [],
		});
	}
</script>

<div class="graph-host" bind:this={host}>
	{#if tip.visible}
		<div class="edge-tip" style="left:{tip.x}px;top:{tip.y}px">{tip.text}</div>
	{/if}
</div>
