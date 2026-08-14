<script>
	import { onDestroy } from "svelte";
	import Sigma from "sigma";
	import { UndirectedGraph } from "graphology";
	import {circular} from "graphology-layout";
	import { getCameraStateToFitViewportToNodes } from "@sigma/utils";
	import forceAtlas2 from "graphology-layout-forceatlas2";
	import FA2Layout from "graphology-layout-forceatlas2/worker";
	import { createNodeBorderProgram } from "@sigma/node-border";
	import { edgeKey, winRateColor } from "./lib.js";

	// Base colour for edges in "Shared matches" mode: a neutral gray, kept
	// distinct from the node colours so the edge layer reads as a separate
	// thing on the dark background.
	const SHARED_MATCH_COLOR = "#9aa0a6";

	// Hover renderer: no-op. The hovered node's label is already drawn by the
	// normal label pass (hovered/blurred logic in nodeReducer), and sigma's
	// default hover would draw a halo that makes the node look bigger. Drawing
	// nothing keeps the node's size unchanged on hover.
	function drawNodeHover() {}

	const ActiveBorderProgram = createNodeBorderProgram({
		drawHover: drawNodeHover,
		borders: [
			{ color: { attribute: "borderColor" }, size: { value: 0.2 } },
			{ color: { attribute: "color" }, size: { fill: true } },
		],
	});

	let {
		viewNodes,
		viewLinks,
		teams,
		jerseyColor,
		teamColor = () => null,
		prevPos = new Map(),
		selectedId,
		selectedEdge,
		onSelect,
		onEdgeSelect = () => {},
		edgeColor = "none",
		alphaMin = 0.05,
		alphaMax = 0.6,
		winRates = new Map(),
		showEdges = true,
		nodeColor = "jersey",
	} = $props();

	// Persist laid-out node positions across reloads so the graph does not have
	// to re-learn its layout from random seeds each time.
	const POS_KEY = "rugby-graph-positions";
	function loadPositions() {
		try {
			const raw = localStorage.getItem(POS_KEY);
			if (!raw) return;
			const obj = JSON.parse(raw);
			for (const k in obj) prevPos.set(Number(k), obj[k]);
		} catch {
			/* ignore corrupt/unavailable storage */
		}
	}
	function savePositions() {
		try {
			const obj = {};
			for (const [k, v] of prevPos) obj[k] = { x: v.x, y: v.y };
			localStorage.setItem(POS_KEY, JSON.stringify(obj));
		} catch {
			/* ignore quota/unavailable storage */
		}
	}
	function capturePositions() {
		if (!graph) return;
		graph.forEachNode((id, attr) => {
			prevPos.set(Number(id), { x: attr.x, y: attr.y });
		});
	}
	loadPositions();

	let host;
	let sigma = null;
	let graph = null;
	let layout = null;
	let clusterLayer = null;
	let activeEdgeLayer = null;
	const clusterDivs = new Map();

	let hoveredId = null;
	let hoverNeighbors = new Set();
	let hoveredOther = null;
	let pinnedId = null;
	let pinnedNeighbors = new Set();
	let pinnedEdge = null;
	let tip = $state({ x: 0, y: 0, visible: false, text: "" });
	let fittedForSel = null;

	// Coalesce bursts of hover events (a mouse crossing many nodes) into a
	// single refresh per animation frame instead of one full re-render per
	// event. This is the main source of main-thread stalls while moving the
	// mouse over the graph.
	let refreshRaf = null;
	function scheduleRefresh() {
		if (refreshRaf != null) return;
		refreshRaf = requestAnimationFrame(() => {
			refreshRaf = null;
			if (sigma) sigma.refresh({ skipIndexation: true });
		});
	}
	let clustersRaf = null;
	function scheduleClusters() {
		if (clustersRaf != null) return;
		clustersRaf = requestAnimationFrame(() => {
			clustersRaf = null;
			updateClusters();
		});
	}

	const focusId = () => hoveredId ?? pinnedId;
	const focusNeighbors = () => (hoveredId != null ? hoverNeighbors : pinnedNeighbors);

	// The other endpoint of the currently selected edge (the node clicked while
	// the main active node was pinned). Its label stays open once clicked.
	const edgePartnerId = () => {
		if (pinnedEdge == null || pinnedId == null) return null;
		const [a, b] = graph.extremities(pinnedEdge);
		return a === pinnedId ? b : a;
	};

	function nodeReducer(node, data) {
		const res = { ...data };
		const f = focusId();
		const isHovered = node === hoveredId || node === hoveredOther;
		const isActive = pinnedId != null && node === pinnedId;
		const isSecondary = f != null && focusNeighbors().has(node);
		const partner = edgePartnerId();
		const isSecondaryActive = node === partner;

		res.isActive = isActive;
		res.isSecondary = isSecondary;
		res.isHovered = isHovered;

		// Node labels appear only on hover, or permanently for the active
		// (selected) node and the active secondary node (the node connected to
		// the active one that was clicked). Blank the label of every other
		// node, since sigma reads this same reduced attribute for both the
		// regular label pass and the hover label box. forceLabel keeps labels
		// visible even below the zoom size threshold.
		if (isActive || isSecondaryActive || isHovered) {
			res.forceLabel = true;
		} else {
			res.label = "";
		}

		if (f != null) {
			if (isActive) {
				res.type = "activeBorder";
			} else if (isSecondaryActive) {
				res.type = "border";
				res.borderColor = "#ffffff";
			} else if (isSecondary) {
				res.type = "border";
			} else if (!isHovered) {
				res.type = "border";
				res.label = "";
				res.color = "#39434f";
				res.borderColor = "transparent";
			} else {
				res.type = "border";
			}
		} else {
			res.type = "border";
		}
		if (isActive) {
			res.borderColor = "#ffffff";
		} else if (res.borderColor === undefined) {
			res.borderColor = needsBorder(res.color);
		}
		return res;
	}

	function edgeReducer(edge, data) {
		const res = { ...data };
		const rawLo = Number(graph.getAttribute("edgeAlphaMin") ?? alphaMin);
		const rawHi = Number(graph.getAttribute("edgeAlphaMax") ?? alphaMax);
		const aMin = Math.min(rawLo, rawHi);
		const aMax = Math.max(rawLo, rawHi);
		if (aMin === 0 && aMax === 0) {
			res.hidden = true;
			return res;
		}
		let base = SHARED_MATCH_COLOR;
		const mode = graph.getAttribute("edgeColorMode");
		if (mode === "winrate") {
			if (data.wr == null) {
				res.hidden = true;
				return res;
			}
			base = data.wr;
		}
		const alpha = aMin + (aMax - aMin) * Math.min(1, Math.max(0, data.recency ?? 0.5));
		res.color = applyAlpha(base, alpha);
		if (pinnedId != null) {
			const [a, b] = graph.extremities(edge);
			const joinsPinned =
				(a === pinnedId && pinnedNeighbors.has(b)) || (b === pinnedId && pinnedNeighbors.has(a));
			const joinsHoveredOther =
				hoveredOther != null &&
				a !== b &&
				((a === pinnedId && b === hoveredOther) || (b === pinnedId && a === hoveredOther));
			if (edge === pinnedEdge) {
				res.color = base;
			} else if (joinsHoveredOther) {
				res.color = base;
			} else if (joinsPinned) {
				// keep global edge style
			} else {
				res.hidden = true;
			}
			return res;
		}
		if (pinnedEdge != null && edge === pinnedEdge) {
			res.color = base;
			return res;
		}
		if (pinnedEdge != null) {
			res.hidden = true;
			return res;
		}
		const f = focusId();
		if (f == null) {
			// No active node: keep the mode/alpha-styled colour above, without
			// stamping any visibility. Return the computed res, not the raw
			// attributes, otherwise build-time winrate colours leak through
			// in "Shared matches" mode.
			if (!showEdges) {
				res.hidden = true;
				return res;
			}
			return res;
		}
		const [a, b] = graph.extremities(edge);
		const adjacent = (a === f && focusNeighbors().has(b)) || (b === f && focusNeighbors().has(a));
		if (!adjacent) res.hidden = true;
		return res;
	}

	// ---- graph building ----
	function nodeSize(n, maxApp) {
		return 4 + 3 * Math.sqrt((n.app || 0) / maxApp);
	}
	function edgeSize(w, maxW) {
		return 0.4 + 4.6 * Math.sqrt(w / maxW);
	}
	function alphaOf(recency) {
		const r = recency == null ? 0.5 : Number(recency);
		const aMin = Math.min(alphaMin, alphaMax);
		const aMax = Math.max(alphaMin, alphaMax);
		return aMin + (aMax - aMin) * Math.min(1, Math.max(0, r));
	}
	function applyAlpha(hex, alpha) {
		const h = String(hex || "").replace("#", "");
		const r = parseInt(h.substr(0, 2), 16) || 0;
		const g = parseInt(h.substr(2, 2), 16) || 0;
		const b = parseInt(h.substr(4, 2), 16) || 0;
		const a = Math.max(0, Math.min(1, +alpha));
		// sigma blends edges with gl.blendFunc(ONE, ONE_MINUS_SRC_ALPHA) on a
		// premultiplied-alpha canvas, but packs the color attribute as
		// NON-premultiplied rgba. That makes translucent edges composite as
		// opaque. Premultiply the rgb channels so the alpha slider actually
		// fades edges into the background.
		return `rgba(${Math.round(r * a)},${Math.round(g * a)},${Math.round(b * a)},${a.toFixed(3)})`;
	}
	function needsBorder(color) {
		if (!color || color === "transparent") return "transparent";
		const hex = color.replace("#", "");
		const r = parseInt(hex.substr(0, 2), 16) || 0;
		const g = parseInt(hex.substr(2, 2), 16) || 0;
		const b = parseInt(hex.substr(4, 2), 16) || 0;
		const lr = Math.round(r + (255 - r) * 0.55);
		const lg = Math.round(g + (255 - g) * 0.55);
		const lb = Math.round(b + (255 - b) * 0.55);
		return "#" + [lr, lg, lb].map((x) => x.toString(16).padStart(2, "0")).join("");
	}

	function buildGraph(nodes, links) {
		const g = new UndirectedGraph();
		const maxApp = Math.max(1, ...nodes.map((n) => n.app || 0));
		const maxW = Math.max(1, ...links.map((l) => l.w));
		for (const n of nodes) {
			const p = prevPos?.get(n.id);
			const nodeColorVal =
				nodeColor === "team"
					? teamColor(n.team)
					: nodeColor === "neutral"
						? "#8a93a0"
						: jerseyColor(n.jersey);
			g.addNode(String(n.id), {
				label: n.name,
				color: nodeColorVal,
				type: "border",
				borderColor: needsBorder(nodeColorVal),
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
		let edgeSeq = 0;
		for (const l of links) {
			const wrate = winRates.get(edgeKey(l.source.id, l.target.id));
			const recency = l.recency;
			g.addEdgeWithKey(String(edgeSeq++), String(l.source.id), String(l.target.id), {
				weight: l.w,
				size: edgeSize(l.w, maxW),
				w: l.w,
				dates: l.dates || [],
				recency,
				wr: wrate != null ? winRateColor(wrate) : null,
				color: applyAlpha(wrate != null ? winRateColor(wrate) : SHARED_MATCH_COLOR, alphaOf(recency)),
			});
		}
		g.setAttribute("edgeColorMode", edgeColor);
		g.setAttribute("edgeAlphaMin", alphaMin);
		g.setAttribute("edgeAlphaMax", alphaMax);
		return g;
	}

	function createSigma() {
		const s = new Sigma(graph, host, {
			labelColor: { color: "#d6dbe2" },
			defaultEdgeColor: SHARED_MATCH_COLOR,
		nodeProgramClasses: {
			border: createNodeBorderProgram({
				drawHover: drawNodeHover,
				borders: [
					{ size: { value: 0.2 }, color: { attribute: "borderColor" } },
					{ size: { fill: true }, color: { attribute: "color" } },
				],
			}),
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

				context.fillStyle = settings.labelColor.color;
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
		s.on("enterNode", ({ node }) => {
			if (pinnedId != null) {
				hoveredOther = node;
				const e = graph.edge(pinnedId, node);
				if (e != null) {
					const pa = graph.getNodeAttributes(pinnedId);
					const pb = graph.getNodeAttributes(node);
					const mid = sigma.graphToViewport({ x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 });
					tip = {
						x: mid.x,
						y: mid.y,
						visible: true,
						text: `${graph.getEdgeAttribute(e, "w")} shared games`,
					};
				}
			} else {
				hoveredId = node;
				hoverNeighbors = new Set(graph.neighbors(node));
			}
			scheduleRefresh();
			window.__hover = { hoveredId, hoveredOther, neighbors: hoverNeighbors.size };
		});
		s.on("leaveNode", () => {
			hoveredId = null;
			hoveredOther = null;
			hoverNeighbors = new Set();
			tip = { x: 0, y: 0, visible: false, text: "" };
			scheduleRefresh();
			window.__hover = { hoveredId: null, neighbors: 0 };
		});
		s.on("afterRender", scheduleClusters);
	s.on("afterRender", drawActiveEdge);

		clusterLayer = s.createLayer("clusters", "div");
		clusterLayer.style.pointerEvents = "none";

		// The active (pinned or hovered-partner) edge is normally drawn in the
		// "edges" canvas, which sits below the nodes canvas. Re-stroke it on a
		// dedicated overlay canvas stacked above the nodes so it reads as the
		// front-most element. The overlay is inserted below the node labels so
		// those still render on top of the highlighted edge.
		activeEdgeLayer = s.createLayer("activeEdge", "canvas", { beforeLayer: "labels" });
		activeEdgeLayer.style.pointerEvents = "none";

		// Sigma reads the WebGL picking buffer (gl.readPixels) on every
		// mousemove - which stalls the main thread. A canvas render stays valid
		// for a whole animation frame, so deduplicate lookups per ~frame bucket:
		// at most one readPixels per frame instead of ~2 per mouse event.
		const rawGetNodeAtPosition = s.getNodeAtPosition.bind(s);
		let pixelReadBucket = -1;
		const nodeHitCache = new Map();
		s.getNodeAtPosition = (position) => {
			const bucket = (performance.now() / 17) | 0;
			if (bucket !== pixelReadBucket) {
				pixelReadBucket = bucket;
				nodeHitCache.clear();
			}
			const key = `${position.x},${position.y}`;
			if (nodeHitCache.has(key)) return nodeHitCache.get(key);
			const res = rawGetNodeAtPosition(position);
			nodeHitCache.set(key, res);
			return res;
		};

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
				g = { sx: 0, sy: 0, n: 0, name: (teams[a.team] && (typeof teams[a.team] === "string" ? teams[a.team] : teams[a.team].name)) || `team ${a.team}` };
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

	// ---- active-edge overlay ----
	// Redraw the highlighted edge (pinned edge, or the edge to a hovered
	// partner) on the overlay canvas so it renders above the other edges and
	// nodes. The stroke spans the full segment (node center to node center),
	// and the two endpoint nodes are re-drawn above it so they stay on top of
	// the edge while every other node remains beneath it. Mirrors edgeReducer's
	// treatment: the mode's base colour at full opacity, normal line width.
	function drawOverlayNode(ctx, pt, nodeId, borderColor) {
		const r = sigma.scaleSize(graph.getNodeAttribute(nodeId, "size"));
		// The border program renders its border ring INSIDE the node: the disc
		// spans [0, 0.8r] and the ring the band [0.8r, r]. Draw the same layout
		// so the overlay is pixel-identical to the node rendered beneath it —
		// an outward ring would make the node look bigger on hover.
		ctx.beginPath();
		ctx.arc(pt.x, pt.y, r * 0.8, 0, Math.PI * 2);
		ctx.fillStyle = graph.getNodeAttribute(nodeId, "color");
		ctx.fill();
		if (borderColor && borderColor !== "transparent") {
			ctx.beginPath();
			ctx.arc(pt.x, pt.y, r * 0.9, 0, Math.PI * 2);
			ctx.strokeStyle = borderColor;
			ctx.lineWidth = Math.max(1, 0.2 * r);
			ctx.stroke();
		}
	}
	function drawActiveEdge() {
		const canvas = activeEdgeLayer;
		if (!canvas || !sigma || !graph || !host) return;
		const ctx = canvas.getContext("2d");
		let key = pinnedEdge;
		if (pinnedId != null && hoveredOther != null) {
			const he = graph.edge(pinnedId, hoveredOther);
			if (he != null) key = he;
		}
		const w = host.clientWidth;
		const h = host.clientHeight;
		const dpr = window.devicePixelRatio || 1;
		const pw = Math.round(w * dpr);
		const ph = Math.round(h * dpr);
		if (canvas.width !== pw || canvas.height !== ph) {
			canvas.width = pw;
			canvas.height = ph;
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		if (key == null || !graph.hasEdge(key)) return;
		const attrs = graph.getEdgeAttributes(key);
		const mode = graph.getAttribute("edgeColorMode");
		let color = SHARED_MATCH_COLOR;
		if (mode === "winrate") {
			if (attrs.wr == null) return;
			color = attrs.wr;
		}
		const [a, b] = graph.extremities(key);
		const pa = graph.getNodeAttributes(a);
		const pb = graph.getNodeAttributes(b);
		const src = sigma.graphToViewport({ x: pa.x, y: pa.y });
		const dst = sigma.graphToViewport({ x: pb.x, y: pb.y });
		ctx.beginPath();
		ctx.moveTo(src.x, src.y);
		ctx.lineTo(dst.x, dst.y);
		ctx.strokeStyle = color;
		ctx.lineWidth = sigma.scaleSize(attrs.size);
		ctx.lineCap = "round";
		ctx.stroke();
		// Mirrors nodeReducer: only the main active endpoint (pinned) and the
		// clicked edge partner get the white active border. A merely hovered
		// endpoint keeps its default ring — hovering must not make a node look
		// selected. This keeps the overlay pixel-identical to the nodes
		// rendered beneath it.
		const borderFor = (nodeId) => (nodeId === pinnedId || nodeId === edgePartnerId() ? "#ffffff" : graph.getNodeAttribute(nodeId, "borderColor"));
		drawOverlayNode(ctx, src, a, borderFor(a));
		drawOverlayNode(ctx, dst, b, borderFor(b));
	}

	// ---- layout ----
	let saveTimer = null;
	let stopTimer = null;
	function stopSaving() {
		if (saveTimer) {
			clearInterval(saveTimer);
			saveTimer = null;
		}
	}
	function stopLayoutTimer() {
		if (stopTimer) {
			clearTimeout(stopTimer);
			stopTimer = null;
		}
	}
	const FA2_SETTLE_EPSILON = 1;
	const FA2_SETTLE_TICKS = 10;
	const FA2_MAX_WAIT_MS = 30000;
	function restartLayout() {
		if (layout) layout.kill();
		layout = new FA2Layout(graph, {
			settings: {
				...forceAtlas2.inferSettings(graph),
				gravity: 0.5,
				slowDown: 50,
				// barnesHutOptimize: true,
				// edgeWeightInfluence: 1,
				// adjustSizes: true,
				// linLogMode: true,
			},
		});
		const myLayout = layout;
		layout.start();
		stopSaving();
		stopLayoutTimer();
		saveTimer = setInterval(() => {
			capturePositions();
			savePositions();
		}, 60000);

		// FA2's web worker runs until stop() is called — there is no built-in
		// "settled" signal. Poll node movement each tick; once positions stop
		// changing (or a hard timeout elapses), stop the worker and frame the
		// view now that the layout has settled.
		let lastPos = null;
		let still = 0;
		let sawMovement = false;
		const t0 = performance.now();
		const poll = () => {
			if (layout !== myLayout || !myLayout.isRunning()) return;
			let moved = 0;
			if (lastPos) {
				graph.forEachNode((id, attr) => {
					const prev = lastPos.get(Number(id));
					if (prev) moved = Math.max(moved, Math.hypot(attr.x - prev.x, attr.y - prev.y));
				});
			}
			lastPos = new Map();
			graph.forEachNode((id, attr) => lastPos.set(Number(id), { x: attr.x, y: attr.y }));
			if (moved >= FA2_SETTLE_EPSILON) {
				sawMovement = true;
				still = 0;
			} else if (sawMovement) {
				// Only count stillness once the worker has actually moved
				// nodes. Before the first update arrives the graph is
				// trivially "still", so without this guard a large graph
				// would be stopped during its first worker round-trip.
				still++;
			}

			if (still >= FA2_SETTLE_TICKS || performance.now() - t0 > FA2_MAX_WAIT_MS) {
				stopLayoutTimer();
				if (layout === myLayout && myLayout.isRunning()) myLayout.stop();
				// Auto-fit only when nothing is selected: a selection already
				// fitted the camera to that node, and snapping to the whole
				// graph here (seconds after the user picked a node) would
				// yank the zoom back out.
				if (pinnedId == null) fitToView();
				return;
			}
			stopTimer = setTimeout(poll, 50);
		};
		poll();
	}

	// ---- lifecycle ----
	let graphStepHandler = null;
	function bindLayoutListener() {
		if (graphStepHandler) graph.removeListener("eachNodeAttributesUpdated", graphStepHandler);
		graphStepHandler = capturePositions;
		graph.on("eachNodeAttributesUpdated", graphStepHandler);
	}


	function rebuild(vn, vl, seedPositions = null) {
		if (layout) {
			layout.kill();
			layout = null;
		}
		stopSaving();
		stopLayoutTimer();
		if (seedPositions !== null) {
			// circular() keys positions by node id string; prevPos is keyed by
			// numeric id (buildGraph lookup + capturePositions convention).
			prevPos = new Map(Object.entries(seedPositions).map(([k, v]) => [Number(k), v]));
		} else {
			capturePositions();
			savePositions(prevPos);
		}
		if (graphStepHandler) graph.removeListener("eachNodeAttributesUpdated", graphStepHandler);
		graphStepHandler = null;
		graph = buildGraph(vn, vl);
		if (!containerReady()) {
			// Container has no dimensions yet (hidden/minimized tab, HMR remount,
			// initial layout race). Constructing sigma now would throw; retry once
			// the host has real size.
			retryWhenContainerReady(vn, vl);
			return;
		}
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
		pinnedEdge = null;
		tip = { x: 0, y: 0, visible: false, text: "" };
		resetClusters();
		if (seedPositions !== null) {
			// A seed was supplied (e.g. the circular layout from "Rebuild
			// Layout"): apply it as initial positions, then let FA2 settle
			// the layout from there. buildGraph reads the seed via prevPos,
			// so restartLayout() starts from the ring instead of a random
			// scatter.
			restartLayout();
		} else {
			restartLayout();
		}
	}

	// ---- rebuild scheduling ----
	let rebuildTimer = null;
	let pendingRebuild = null;
	let hostSize = { w: 0, h: 0 };
	function containerReady() {
		return host != null && hostSize.w > 0 && hostSize.h > 0;
	}
	function retryWhenContainerReady(vn, vl) {
		pendingRebuild = [vn, vl];
	}
	function flushPendingRebuild() {
		if (!pendingRebuild) return;
		const [vn, vl] = pendingRebuild;
		pendingRebuild = null;
		scheduleRebuild(vn, vl);
	}

	// Container dimensions are tracked via ResizeObserver instead of polling
	// offsetWidth/offsetHeight in a rAF loop, which forced synchronous layout
	// on every frame until the host had a size.
	$effect(() => {
		const el = host;
		if (!el) return;
		const updateSize = () => {
			hostSize = { w: el.offsetWidth, h: el.offsetHeight };
		};
		updateSize();
		const observer = new ResizeObserver(() => {
			updateSize();
			if (containerReady()) flushPendingRebuild();
		});
		observer.observe(el);
		return () => observer.disconnect();
	});
	function scheduleRebuild(vn, vl) {
		if (rebuildTimer != null) clearTimeout(rebuildTimer);
		if (graph == null) {
			// First build happens synchronously; later ones debounce so that
			// rapid filter changes collapse into a single graph rebuild.
			rebuild(vn, vl);
			return;
		}
		rebuildTimer = setTimeout(() => {
			rebuildTimer = null;
			rebuild(vn, vl);
		}, 150);
	}

	$effect(() => {
		const vn = viewNodes;
		const vl = viewLinks;
		if (!vn || !host) return;
		scheduleRebuild(vn, vl);
	});

	// Recolour edges in place when the edge colour mode changes. Building the
	// graph only reads edgeColor once; without this the dropdown would do
	// nothing until the next filter-driven rebuild.
	$effect(() => {
		// Recolour nodes in place when the node colour mode changes (jersey vs
		// team), without rebuilding the graph or disturbing the layout.
		const mode = nodeColor;
		if (!graph || !sigma) return;
		graph.forEachNode((node, attrs) => {
			graph.setNodeAttribute(
				node,
			"color",
			mode === "team"
				? teamColor(attrs.team)
				: mode === "neutral"
					? "#8a93a0"
					: jerseyColor(attrs.jersey),
			);
		});
		sigma.refresh({ skipIndexation: true });
	});

	$effect(() => {
		// Edge colours (incl. alpha) are computed per-frame in edgeReducer;
		// the reducer reads the live values from graph attributes, so write
		// them here whenever the props change and refresh. This also covers
		// paths that bypass the UI handlers (keyboard binds, Reset).
		if (!graph) return;
		graph.setAttribute("edgeColorMode", edgeColor);
		graph.setAttribute("edgeAlphaMin", alphaMin);
		graph.setAttribute("edgeAlphaMax", alphaMax);
		if (sigma) sigma.refresh({ skipIndexation: true });
	});

	$effect(() => {
		// Re-run edgeReducer whenever the edges toggle changes so the hidden
		// flags update without a full graph rebuild. The same refresh path the
		// selection effect uses to re-stamp edge visibility.
		showEdges;
		if (sigma && graph) sigma.refresh({ skipIndexation: true });
	});

	$effect(() => {
		const sel = selectedId;
		if (sigma && graph) {
			if (sel != null && graph.hasNode(String(sel))) {
				pinnedId = String(sel);
				pinnedNeighbors = new Set(graph.neighbors(String(sel)));
				if (sel !== fittedForSel) {
					// A node just became active (e.g. graph click, search pick):
					// show it and its neighbours. Skip when sel is unchanged so
					// filter-driven graph rebuilds don't yank the camera.
					fittedForSel = sel;
					fitToNodes([String(sel), ...pinnedNeighbors]);
				}
			} else {
				pinnedId = null;
				pinnedNeighbors = new Set();
				fittedForSel = null;
			}
			pinnedEdge = selectedEdge?.key && graph.hasEdge(selectedEdge.key) ? selectedEdge.key : null;
			sigma.refresh({ skipIndexation: true });
		}
		window.__sel = { selectedId, hasSigma: !!sigma };
	});

	onDestroy(() => {
		if (refreshRaf != null) cancelAnimationFrame(refreshRaf);
		if (clustersRaf != null) cancelAnimationFrame(clustersRaf);
		if (rebuildTimer != null) clearTimeout(rebuildTimer);
		stopSaving();
		stopLayoutTimer();
		capturePositions();
		savePositions(prevPos);
		if (layout) layout.kill();
		if (sigma) sigma.kill();
	});

	// Fit the camera so every given node stays fully inside the viewport,
	// accounting for each node's radius (fitViewportToNodes only bounds the
	// node-position bbox, so edge nodes get clipped). We take the exact fit
	// state, then shrink the ratio so the largest node keeps a full-radius
	// margin on every side.
	function fitToNodes(nodeKeys) {
		if (!sigma || !graph || nodeKeys.length === 0) return;
		const state = getCameraStateToFitViewportToNodes(sigma, nodeKeys);
		const dims = sigma.getDimensions();
		const { width, height } = dims;
		let groupMinX = Infinity, groupMaxX = -Infinity, groupMinY = Infinity, groupMaxY = -Infinity;
		let maxSize = 0;
		for (const id of nodeKeys) {
			const a = graph.getNodeAttributes(id);
			groupMinX = Math.min(groupMinX, a.x);
			groupMaxX = Math.max(groupMaxX, a.x);
			groupMinY = Math.min(groupMinY, a.y);
			groupMaxY = Math.max(groupMaxY, a.y);
			maxSize = Math.max(maxSize, a.size || 0);
		}
		const groupWidth = groupMaxX - groupMinX || 1;
		const groupHeight = groupMaxY - groupMinY || 1;
		// Which viewport axis does the fit pin against?
		const widthLimiting = groupHeight / groupWidth < height / width;
		const limitDim = widthLimiting ? width : height;
		// Rendered node radius (px) at ratio r, with the default screen
		// size-reference: size / sqrt(ratio).
		const radiusPx = (r) => maxSize / Math.sqrt(r);
		// The bbox spans `limitDim` px at ratio state.ratio, and pixel width
		// scales as 1/ratio. Find r so bbox + 2·radius fill the viewport:
		//   limitDim·state.ratio / r + 2·radius(r) = limitDim
		// Fixed-point iteration on that constraint:
		let r = state.ratio;
		for (let i = 0; i < 4; i++) {
			r = (state.ratio * limitDim) / (limitDim - 2 * radiusPx(r));
		}
		sigma.getCamera().animate({ ...state, ratio: r });
	}

	export function fitToView() {
		if (sigma && graph && graph.order > 0) {
			const nodeKeys = [];
			graph.forEachNode((id) => nodeKeys.push(id));
			fitToNodes(nodeKeys);
		}
	}

	export function zoomToTeam(teamId) {
		if (!sigma || !graph) return;
		const nodeKeys = [];
		graph.forEachNode((id, attr) => {
			if (attr.team === teamId) {
				nodeKeys.push(id);
			}
		});
		if (nodeKeys.length > 0) {
			fitToNodes(nodeKeys);
		}
	}

	export function hoverPartner(nodeId) {
		if (!graph) return;
		hoveredOther = nodeId != null ? String(nodeId) : null;
		if (sigma) sigma.refresh({ skipIndexation: true });
	}

	export function setEdgeAlpha(lo, hi) {
		if (!graph) return;
		graph.setAttribute("edgeAlphaMin", lo);
		graph.setAttribute("edgeAlphaMax", hi);
		if (sigma) sigma.refresh({ skipIndexation: true });
	}

	export function setEdgeColorMode(mode) {
		if (!graph) return;
		graph.setAttribute("edgeColorMode", mode);
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

	export function forceRebuild() {
		// const seed = computeSeedPositions(viewNodes);
		const seed = circular(graph,{scale: 100});
		rebuild(viewNodes, viewLinks, seed);
	}
</script>

<div class="graph-host" bind:this={host}>
	{#if tip.visible}
		<div class="edge-tip" style="left:{tip.x}px;top:{tip.y}px">{tip.text}</div>
	{/if}
</div>
