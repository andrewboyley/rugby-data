<script lang="ts">
	import { onDestroy } from "svelte";
	import { push } from "svelte-spa-router";
	import Graph from "graphology";
	import { circular } from "graphology-layout";
	import forceAtlas2 from "graphology-layout-forceatlas2";
	import Sigma from "sigma";
	import { NodeCircleProgram } from "sigma/rendering";
	import louvain from "graphology-communities-louvain";
	import { getCameraStateToFitViewportToNodes } from "@sigma/utils";
	import LiveViewPanel from "./LiveViewPanel.svelte";
	import type { LayoutTickStats } from "./graph/layout";

	const CHUNK_SIZE = 20;
	const CLUSTER_COLORS = [
		"#e03131", "#1971c2", "#40c057", "#fa923f",
		"#862e9c", "#e8590c", "#109868", "#0b7285",
		"#c2255c", "#5c940d", "#9c36b5", "#e67700",
	];

	async function goHome() { await push("/"); }

	let nodeCount = $state(200);
	let edgeProbability = $state(0.01);
	let clusterCount = $state(10);
	let clusterStrength = $state(3);
	let seed = $state(42);
	let intraClusterOnly = $state(true);
	let intraWeightMean = $state(2);
	let intraWeightStd = $state(0.5);
	let interWeightMean = $state(0.45);
	let interWeightStd = $state(0.15);
	let autoFit = $state(true);
	let showGrid = $state(true);
	let settingsTab = $state<"graph" | "fa2">("graph");
	let sidebarOpen = $state(true);
	let bottomOpen = $state(true);
	let suppressCameraUpdate = false;

	let fa2Settings = $state({
		gravity: 1,
		slowDown: 1,
		scalingRatio: 10,
		strongGravityMode: false,
		barnesHutOptimize: true,
		barnesHutTheta: 0.5,
		edgeWeightInfluence: 1,
		outboundAttractionDistribution: false,
		linLogMode: false,
		adjustSizes: false,
	});

	let layoutRunning = $state(false);
	let iterations = $state(0);
	let layoutQuality = $state(0);

	let host: HTMLDivElement | null = null;
	let gridCanvas: HTMLCanvasElement | null = null;
	let sigmaInstance: Sigma | null = null;
	let containerObserver: ResizeObserver | null = null;
	let currentGraph: Graph | null = null;
	let rafId: number | null = null;

	let tickStats = $state<LayoutTickStats[]>([]);
	let previousPositions = new Map<string, { x: number; y: number }>();

	function fitCamera(animate = true) {
		if (!sigmaInstance || !currentGraph || currentGraph.order === 0) return;
		const nodeKeys: string[] = [];
		currentGraph.forEachNode((id) => nodeKeys.push(id));
		const state = getCameraStateToFitViewportToNodes(sigmaInstance, nodeKeys);
		suppressCameraUpdate = true;
		if (animate) {
			sigmaInstance.getCamera().animate({ ...state }, {}, () => { suppressCameraUpdate = false; });
		} else {
			sigmaInstance.getCamera().setState({ ...state });
			suppressCameraUpdate = false;
		}
	}

	function drawGrid() {
		const c = gridCanvas;
		if (!c || !sigmaInstance) return;
		const ctx = c.getContext("2d");
		if (!ctx) return;
		const dpr = devicePixelRatio || 1;
		const cssW = c.width / dpr, cssH = c.height / dpr;
		const cam = sigmaInstance.getCamera();
		const ratio = cam.ratio;
		const cx = cam.x, cy = cam.y;
		const spacing = Math.pow(2, Math.ceil(Math.log2(ratio * 60)));
		ctx.clearRect(0, 0, c.width, c.height);
		if (!showGrid) return;
		const halfW = (cssW / 2) * ratio;
		const halfH = (cssH / 2) * ratio;
		const graphLeft = cx - halfW;
		const graphRight = cx + halfW;
		const graphTop = cy - halfH;
		const graphBottom = cy + halfH;
		const firstX = Math.floor(graphLeft / spacing) * spacing;
		const firstY = Math.floor(graphTop / spacing) * spacing;
		ctx.strokeStyle = "rgba(128,128,128,0.15)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let gx = firstX; gx <= graphRight; gx += spacing) {
			const sx = ((gx - cx) / ratio + cssW / 2) * dpr;
			ctx.moveTo(sx, 0);
			ctx.lineTo(sx, c.height);
		}
		for (let gy = firstY; gy <= graphBottom; gy += spacing) {
			const sy = ((gy - cy) / ratio + cssH / 2) * dpr;
			ctx.moveTo(0, sy);
			ctx.lineTo(c.width, sy);
		}
		ctx.stroke();
	}

	function savePositions() {
		const map = new Map<string, { x: number; y: number }>();
		if (!currentGraph) return map;
		currentGraph.forEachNode((id, attrs) => {
			const a = attrs as { x: number; y: number };
			map.set(id, { x: a.x, y: a.y });
		});
		return map;
	}

	function computeTickStats(prev: Map<string, { x: number; y: number }>): LayoutTickStats | null {
		if (!currentGraph || currentGraph.order === 0 || prev.size === 0) return null;
		let totalDisp = 0, maxDisp = 0, sumSqDisp = 0, count = 0;
		currentGraph.forEachNode((id, attrs) => {
			const a = attrs as { x: number; y: number };
			const p = prev.get(id);
			if (p) {
				const dx = a.x - p.x, dy = a.y - p.y;
				const d = Math.sqrt(dx * dx + dy * dy);
				totalDisp += d; sumSqDisp += d * d;
				if (d > maxDisp) maxDisp = d;
				count++;
			}
		});
		if (count === 0) return null;
		const mean = totalDisp / count;
		const variance = count > 1 ? sumSqDisp / count - mean * mean : 0;
		return {
			timestamp: performance.now(),
			meanDisplacement: mean,
			maxDisplacement: maxDisp,
			stdDisplacement: Math.sqrt(Math.max(0, variance)),
			kineticEnergy: totalDisp,
			nodeCount: currentGraph.order,
			settledProgress: 1 - Math.min(1, mean),
		};
	}

	function destroySigma() {
		if (gridRafId) { cancelAnimationFrame(gridRafId); gridRafId = null; }
		if (containerObserver) { containerObserver.disconnect(); containerObserver = null; }
		if (sigmaInstance) { sigmaInstance.kill(); sigmaInstance = null; }
	}

	let gridRafId: number | null = null;
	function startGridLoop() {
		if (gridRafId) cancelAnimationFrame(gridRafId);
		const tick = () => {
			drawGrid();
			gridRafId = requestAnimationFrame(tick);
		};
		gridRafId = requestAnimationFrame(tick);
	}

	function rebuildGraph() {
		const container = host;
		destroySigma();
		tickStats = [];
		previousPositions = new Map();

		const g = new Graph({ multi: false });
		const rng = mulberry32(seed);
		const baseSize = Math.max(1, Math.min(20, 120 / Math.sqrt(nodeCount)));
		const nodeList: { id: string; cluster: number }[] = [];
		for (let i = 0; i < nodeCount; i++) {
			const cluster = Math.floor(rng() * clusterCount);
			nodeList.push({ id: `n${i}`, cluster });
			g.addNode(`n${i}`, { cluster, label: `Node ${i}`, size: baseSize, color: CLUSTER_COLORS[cluster % CLUSTER_COLORS.length] });
		}
		for (let i = 0; i < nodeCount; i++) {
			for (let j = i + 1; j < nodeCount; j++) {
				const sameCluster = nodeList[i].cluster === nodeList[j].cluster;
				if (intraClusterOnly && !sameCluster) continue;
				const prob = sameCluster ? edgeProbability * clusterStrength : edgeProbability;
			if (rng() < prob) {
					const mean = sameCluster ? intraWeightMean : interWeightMean;
					const std = sameCluster ? intraWeightStd : interWeightStd;
					const w = Math.max(0.01, normalSample(rng, mean, std));
					g.addEdge(nodeList[i].id, nodeList[j].id, { weight: w });
				}
			}
		}
		circular.assign(g, { scale: 100 });
		currentGraph = g;

		if (!container) return;
		const s = new Sigma(g, container, {
			labelColor: { color: "#ddd" },
			defaultEdgeColor: "#ccc",
			allowInvalidContainer: true,
			nodeProgramClasses: { circle: NodeCircleProgram },
		});
		sigmaInstance = s;
		suppressCameraUpdate = true;
		s.resize();
		fitCamera(false);
		suppressCameraUpdate = false;
		s.getCamera().addListener("updated", () => {
			drawGrid();
			if (!suppressCameraUpdate && autoFit) autoFit = false;
		});
		s.addListener("afterRender", () => { drawGrid(); });
		containerObserver = new ResizeObserver(() => {
			if (autoFit && sigmaInstance === s) {
				requestAnimationFrame(() => {
					suppressCameraUpdate = true;
					s.resize();
					s.refresh();
					fitCamera(false);
					suppressCameraUpdate = false;
				});
			}
		});
		containerObserver.observe(container);
		s.refresh();
		startGridLoop();
	}

	$effect(() => {
		const _n = nodeCount, _e = edgeProbability, _c = clusterCount, _s = clusterStrength, _sd = seed, _ic = intraClusterOnly, _iwm = intraWeightMean, _iws = intraWeightStd, _ewm = interWeightMean, _ews = interWeightStd;
		void _n; void _e; void _c; void _s; void _sd; void _ic; void _iwm; void _iws; void _ewm; void _ews;
		rebuildGraph();
	});

	$effect(() => {
		if (autoFit) fitCamera(true);
	});

	$effect(() => {
		const c = gridCanvas;
		const h = host;
		if (!c || !h) return;
		const ro = new ResizeObserver((entries) => {
			for (const e of entries) {
				const { width, height } = e.contentRect;
				c.width = width * devicePixelRatio;
				c.height = height * devicePixelRatio;
				c.style.width = width + "px";
				c.style.height = height + "px";
			}
		});
		ro.observe(h);
		return () => ro.disconnect();
	});

	function startLayout() {
		if (!currentGraph || layoutRunning) return;
		layoutRunning = true;
		iterations = 0;
		layoutQuality = 0;
		tickStats = [];
		previousPositions = savePositions();
		runLayoutChunk();
	}

	function runLayoutChunk() {
		if (!layoutRunning || !currentGraph) return;
		const prev = previousPositions;
		forceAtlas2.assign(currentGraph, { iterations: CHUNK_SIZE, settings: { ...fa2Settings } });
		iterations += CHUNK_SIZE;
		const stat = computeTickStats(prev);
		if (stat) tickStats = [...tickStats, stat];
		previousPositions = savePositions();
		if (iterations % 100 === 0) updateQuality();
		if (sigmaInstance) sigmaInstance.refresh({ skipIndexation: true });

		if (layoutRunning) rafId = requestAnimationFrame(runLayoutChunk);
	}

	function stopLayout() {
		layoutRunning = false;
		if (rafId) cancelAnimationFrame(rafId);
		rafId = null;
		requestAnimationFrame(() => fitCamera(true));
	}

	function updateQuality() {
		if (!currentGraph) return;
		try {
			const g = currentGraph;
			const communities = louvain(g, { getEdgeWeight: "weight", resolution: 1 });
			let modularity = 0;
			const m = g.size;
			if (m > 0) {
				for (const edge of g.edges()) {
					const [u, v] = g.extremities(edge);
					const w = g.getEdgeAttribute(edge, "weight") as number || 1;
					let ku = 0, kv = 0;
					g.forEachEdge(u, (_e) => { ku += g.getEdgeAttribute(_e, "weight") as number || 1; });
					g.forEachEdge(v, (_e) => { kv += g.getEdgeAttribute(_e, "weight") as number || 1; });
					if (communities[u] === communities[v]) modularity += w - (ku * kv) / (2 * m);
				}
				modularity /= (2 * m);
			}
			layoutQuality = modularity;
		} catch { layoutQuality = 0; }
	}

	onDestroy(() => { stopLayout(); destroySigma(); });

	function mulberry32(a: number) {
		return function () {
			let t = (a += 0x6d2b79f5);
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	function normalSample(rng: () => number, mean: number, std: number): number {
		const u1 = rng() || 1e-10;
		const u2 = rng();
		return mean + std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
	}
</script>

<div class="flex flex-col h-screen bg-base-100 text-base-content">
	<!-- Top area: sidebar + graph -->
	<div class="flex-1 flex min-h-0">
		<!-- Left sidebar: tabs + settings -->
		{#if sidebarOpen}
			<div class="w-72 shrink-0 border-r border-base-300 bg-base-200 flex flex-col relative">
				<!-- Sub-tabs -->
				<div class="tabs tabs-boxed tabs-sm p-1 pb-0">
					<button class="tab tab-sm {settingsTab === 'graph' ? 'tab-active' : ''}" onclick={() => (settingsTab = 'graph')}>Graph</button>
					<button class="tab tab-sm {settingsTab === 'fa2' ? 'tab-active' : ''}" onclick={() => (settingsTab = 'fa2')}>ForceAtlas2</button>
				</div>

				<!-- Settings content -->
				<div class="flex-1 overflow-y-auto px-3 py-2">
					{#if settingsTab === 'graph'}
						<div class="flex flex-col gap-2">
							<fieldset class="fieldset border border-base-300 rounded-box p-2">
								<legend class="fieldset-legend text-xs">Generation</legend>
								<div class="flex flex-col gap-1.5">
									<label class="flex items-center gap-2 text-xs font-mono">
										<span class="w-16">Nodes</span>
										<input type="range" min="1" max="2000" step="1" bind:value={nodeCount} class="range range-xs flex-1" />
										<span class="w-10 text-right">{nodeCount}</span>
									</label>
									<label class="flex items-center gap-2 text-xs font-mono">
										<span class="w-16">Edge Prob</span>
										<input type="range" min="0.001" max="0.1" step="0.001" bind:value={edgeProbability} class="range range-xs flex-1" />
										<span class="w-10 text-right">{edgeProbability.toFixed(3)}</span>
									</label>
									<label class="flex items-center gap-2 text-xs font-mono">
										<span class="w-16">Clusters</span>
										<input type="range" min="1" max="20" step="1" bind:value={clusterCount} class="range range-xs flex-1" />
										<span class="w-10 text-right">{clusterCount}</span>
									</label>
									<label class="flex items-center gap-2 text-xs font-mono">
										<span class="w-16">Strength</span>
										<input type="range" min="1" max="20" step="1" bind:value={clusterStrength} class="range range-xs flex-1" />
										<span class="w-10 text-right">{clusterStrength}x</span>
									</label>
									<div class="flex flex-col gap-0.5">
										<span class="w-16 text-xs font-mono text-base-content/60">Intra Wt</span>
										<label class="flex items-center gap-2 text-xs font-mono">
											<span class="w-16">μ</span>
											<input type="range" min="0" max="10" step="0.1" bind:value={intraWeightMean} class="range range-xs flex-1" />
											<span class="w-10 text-right">{intraWeightMean.toFixed(1)}</span>
										</label>
										<label class="flex items-center gap-2 text-xs font-mono">
											<span class="w-16">σ</span>
											<input type="range" min="0.01" max="5" step="0.01" bind:value={intraWeightStd} class="range range-xs flex-1" />
											<span class="w-10 text-right">{intraWeightStd.toFixed(2)}</span>
										</label>
									</div>
									<div class="flex flex-col gap-0.5">
										<span class="w-16 text-xs font-mono text-base-content/60">Inter Wt</span>
										<label class="flex items-center gap-2 text-xs font-mono">
											<span class="w-16">μ</span>
											<input type="range" min="0" max="10" step="0.1" bind:value={interWeightMean} class="range range-xs flex-1" />
											<span class="w-10 text-right">{interWeightMean.toFixed(1)}</span>
										</label>
										<label class="flex items-center gap-2 text-xs font-mono">
											<span class="w-16">σ</span>
											<input type="range" min="0.01" max="5" step="0.01" bind:value={interWeightStd} class="range range-xs flex-1" />
											<span class="w-10 text-right">{interWeightStd.toFixed(2)}</span>
										</label>
									</div>
									<label class="flex items-center gap-2 text-xs font-mono">
										<span class="w-16">Seed</span>
										<input type="number" bind:value={seed} class="input input-bordered input-xs font-mono w-20" />
									</label>
								</div>
							</fieldset>
							<fieldset class="fieldset border border-base-300 rounded-box p-2">
								<legend class="fieldset-legend text-xs">Options</legend>
								<div class="flex flex-col gap-1">
									<label class="flex items-center gap-1.5 text-xs font-mono cursor-pointer">
										<input type="checkbox" bind:checked={intraClusterOnly} class="checkbox checkbox-xs" />
										Intra-cluster only
									</label>
								</div>
							</fieldset>
						</div>

					{:else if settingsTab === 'fa2'}
						<div class="flex flex-col gap-2">
							<fieldset class="fieldset border border-base-300 rounded-box p-2">
								<legend class="fieldset-legend text-xs">Parameters</legend>
								<div class="flex flex-col gap-1.5">
									<label class="flex items-center gap-2 text-xs font-mono">
										<span class="w-16">Gravity</span>
										<input type="range" min="0.01" max="10" step="0.01" bind:value={fa2Settings.gravity} class="range range-xs flex-1" />
										<span class="w-10 text-right">{fa2Settings.gravity}</span>
									</label>
									<label class="flex items-center gap-2 text-xs font-mono">
										<span class="w-16">SlowDown</span>
										<input type="range" min="0.1" max="50" step="0.1" bind:value={fa2Settings.slowDown} class="range range-xs flex-1" />
										<span class="w-10 text-right">{fa2Settings.slowDown}</span>
									</label>
									<label class="flex items-center gap-2 text-xs font-mono">
										<span class="w-16">Scaling</span>
										<input type="range" min="1" max="100" step="1" bind:value={fa2Settings.scalingRatio} class="range range-xs flex-1" />
										<span class="w-10 text-right">{fa2Settings.scalingRatio}</span>
									</label>
									<label class="flex items-center gap-2 text-xs font-mono">
										<span class="w-16">BH Theta</span>
										<input type="range" min="0.1" max="1" step="0.05" bind:value={fa2Settings.barnesHutTheta} class="range range-xs flex-1" />
										<span class="w-10 text-right">{fa2Settings.barnesHutTheta}</span>
									</label>
									<label class="flex items-center gap-2 text-xs font-mono">
										<span class="w-16">Edge Wt</span>
										<input type="range" min="0" max="5" step="0.1" bind:value={fa2Settings.edgeWeightInfluence} class="range range-xs flex-1" />
										<span class="w-10 text-right">{fa2Settings.edgeWeightInfluence}</span>
									</label>
								</div>
							</fieldset>
							<fieldset class="fieldset border border-base-300 rounded-box p-2">
								<legend class="fieldset-legend text-xs">Options</legend>
								<div class="flex flex-col gap-1">
									<label class="flex items-center gap-1.5 text-xs font-mono cursor-pointer">
										<input type="checkbox" bind:checked={fa2Settings.strongGravityMode} class="checkbox checkbox-xs" />
										Strong Gravity
									</label>
									<label class="flex items-center gap-1.5 text-xs font-mono cursor-pointer">
										<input type="checkbox" bind:checked={fa2Settings.barnesHutOptimize} class="checkbox checkbox-xs" />
										BH Optimize
									</label>
									<label class="flex items-center gap-1.5 text-xs font-mono cursor-pointer">
										<input type="checkbox" bind:checked={fa2Settings.outboundAttractionDistribution} class="checkbox checkbox-xs" />
										Outbound
									</label>
									<label class="flex items-center gap-1.5 text-xs font-mono cursor-pointer">
										<input type="checkbox" bind:checked={fa2Settings.linLogMode} class="checkbox checkbox-xs" />
										LinLog
									</label>
									<label class="flex items-center gap-1.5 text-xs font-mono cursor-pointer">
										<input type="checkbox" bind:checked={fa2Settings.adjustSizes} class="checkbox checkbox-xs" />
										Adjust Sizes
									</label>
								</div>
							</fieldset>
				</div>

				{/if}
			</div>

			<!-- Collapse button -->
			<button
				class="btn btn-sm btn-ghost absolute top-1 right-1 z-10 bg-base-300/80 backdrop-blur"
				onclick={() => (sidebarOpen = false)}
			>&lsaquo;</button>
			</div>
		{:else}
			<button
				class="btn btn-sm btn-ghost shrink-0 self-start m-1 bg-base-300/80 backdrop-blur"
				onclick={() => (sidebarOpen = true)}
			>&rsaquo;</button>
		{/if}

		<!-- Graph canvas -->
		<div class="relative flex-1 min-h-0">
			<div class="absolute inset-0" bind:this={host}></div>
			<canvas bind:this={gridCanvas} class="absolute inset-0 pointer-events-none z-10"></canvas>
			<!-- Floating back button -->
			<div class="absolute top-3 left-3 z-10">
				<button class="btn btn-ghost btn-sm bg-base-200/80 backdrop-blur" onclick={goHome}>&larr; Back</button>
			</div>
			<!-- Floating iteration count -->
			{#if layoutRunning}
				<div class="absolute top-3 right-3 z-10">
					<span class="badge badge-primary badge-sm gap-1">
						<span class="loading loading-dots loading-xs"></span>
						Iter: {iterations}
					</span>
				</div>
			{/if}
			<!-- Bottom right: layout controls -->
			<div class="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-2">
				<div class="flex flex-col gap-1 text-xs font-mono bg-base-200/80 backdrop-blur rounded px-2 py-1.5">
					<label class="flex items-center gap-1.5 cursor-pointer select-none">
						<input type="checkbox" bind:checked={autoFit} class="checkbox checkbox-xs" />
						Auto-fit
					</label>
					<label class="flex items-center gap-1.5 cursor-pointer select-none">
						<input type="checkbox" bind:checked={showGrid} class="checkbox checkbox-xs" />
						Grid
					</label>
				</div>
			</div>
	</div>
	</div>

	<!-- Bottom: Live View (full width) -->
	<div class="shrink-0 border-t border-base-300 bg-base-200 flex flex-col relative">
		<!-- Collapse toggle bar -->
		<button
			class="btn btn-sm btn-ghost bg-base-300/80 backdrop-blur self-start mx-2 mt-1"
			onclick={() => (bottomOpen = !bottomOpen)}
		>
			{bottomOpen ? "▼" : "▲"} Live View
			{#if tickStats.length > 0}
				<span class="badge badge-xs badge-primary ml-1 px-1.5 py-0.5">{tickStats.length}</span>
			{/if}
		</button>
		{#if bottomOpen}
			<div class="overflow-y-auto px-3 pb-2" style="max-height: 22rem;">
					<LiveViewPanel
					stats={tickStats}
					running={layoutRunning}
					quality={layoutQuality}
					onStartStop={layoutRunning ? stopLayout : startLayout}
					onReset={() => { stopLayout(); rebuildGraph(); }}
				/>
			</div>
		{/if}
	</div>
</div>
