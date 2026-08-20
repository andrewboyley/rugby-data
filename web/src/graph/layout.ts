// ForceAtlas2 layout management. The layout runs continuously; coordinates are
// normalized on every tick so what sigma renders stays bounded.

import forceAtlas2 from "graphology-layout-forceatlas2";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import { circular } from "graphology-layout";
import type Graph from "graphology";
import { normalizePositions } from "./camera";

const POSITION_SAVE_INTERVAL_MS = 60_000;
const STATS_POLL_MS = 50;

const LAYOUT_SETTINGS = {
	outboundAttractionDistribution: true,
	edgeWeightInfluence: 1,
	scalingRatio: 10,
	strongGravityMode: true,
	gravity: 0.05,
	slowDown: 10,
	barnesHutOptimize: true,
	barnesHutTheta: 0.5,
};

// graphology-layout types LayoutMapping as {[node: string]: {[dimension: string]: number}}
// We use a more specific local alias for the position store.
type LayoutPositions = Record<string, { x: number; y: number }>;

export function circularSeed(graph: Graph): LayoutPositions {
	const raw = circular(graph, { scale: 100 });
	const out: LayoutPositions = {};
	for (const key in raw) {
		const val = (raw as Record<string, { x: number; y: number }>)[key];
		out[key] = { x: val.x, y: val.y };
	}
	return out;
}

export interface LayoutTickStats {
	timestamp: number;
	meanDisplacement: number;
	maxDisplacement: number;
	stdDisplacement: number;
	kineticEnergy: number;
	nodeCount: number;
	edgeCrossings?: number;
	minCrossingAngle?: number;
	meanCrossingAngle?: number;
	angularResolution?: number;
	edgeLengthCV?: number;
	nodeSpread?: number;
	aspectRatio?: number;
	totalEdgeLength?: number;
	/** Mean node distance to the origin, relative to mean edge length. */
	centerDistRatio?: number;
}

export interface AestheticMetrics {
	edgeCrossings: number;
	minCrossingAngle: number | null;
	meanCrossingAngle: number | null;
	angularResolution: number | null;
	edgeLengthCV: number;
	nodeSpread: number;
	aspectRatio: number;
	totalEdgeLength: number;
}

export interface LayoutManagerCallbacks {
	onNodeMove: () => void;
	/** Fired on every layout tick, after coordinates have been normalized to [0, 1]. */
	onNodeMoved?: () => void;
	onLayoutTick?: (stats: LayoutTickStats) => void;
}

// The FA2 worker writes its (unbounded) coordinates straight into the graph on
// every message and immediately asks for the next iteration. Sigma renders from
// the graph each frame, so to keep what is drawn bounded we normalize the
// coordinates right after the worker writes them. We patch the supervisor's
// message handler once (the worker has no per-tick user callback). The
// normalized coordinates are what sigma renders; the worker keeps computing in
// its own space.
let handleMessagePatched = false;
let activeCallbacks: LayoutManagerCallbacks | null = null;

function ensureNormalizedHandleMessage(): void {
	if (handleMessagePatched) return;
	const proto = FA2Layout.prototype as unknown as {
		handleMessage: (event: MessageEvent) => void;
	};
	const original = proto.handleMessage;
	proto.handleMessage = function (this: { graph: Graph }, event: MessageEvent) {
		original.call(this, event);
		normalizePositions(this.graph);
		activeCallbacks?.onNodeMoved?.();
	};
	handleMessagePatched = true;
}

export function createLayoutManager(graph: Graph, callbacks: LayoutManagerCallbacks) {
	let layout: FA2Layout | null = null;
	let saveTimer: ReturnType<typeof setInterval> | null = null;
	let statsTimer: ReturnType<typeof setTimeout> | null = null;

	function start(): void {
		if (layout) layout.kill();
		activeCallbacks = callbacks;
		ensureNormalizedHandleMessage();
		const current = new FA2Layout(graph, {
			settings: { ...forceAtlas2.inferSettings(graph), ...LAYOUT_SETTINGS },
		});
		layout = current;
		current.start();
		stopTimers();
		saveTimer = setInterval(callbacks.onNodeMove, POSITION_SAVE_INTERVAL_MS);
		pollLayoutStats(current);
	}

	function stop(): void {
		stopTimers();
		if (layout) {
			layout.stop();
			layout = null;
		}
	}

	function pollLayoutStats(current: FA2Layout): void {
		let lastPos: Map<number, { x: number; y: number }> | null = null;
		const tick = () => {
			if (layout !== current || !current.isRunning()) {
				return;
			}

			let movedSum = 0;
			let movedSumSq = 0;
			let movedCount = 0;
			let maxMoved = 0;
			if (lastPos) {
				graph.forEachNode((id, attrs) => {
					const prev = lastPos!.get(Number(id));
					if (prev) {
						const d = Math.hypot(attrs.x - prev.x, attrs.y - prev.y);
						movedSum += d;
						movedSumSq += d * d;
						movedCount++;
						if (d > maxMoved) maxMoved = d;
					}
				});
			}
			const meanMoved = movedCount > 0 ? movedSum / movedCount : 0;
			const stdMoved = movedCount > 1
				? Math.sqrt(Math.max(0, movedSumSq / movedCount - meanMoved * meanMoved))
				: 0;
			const kineticEnergy = movedSumSq;

			let nodeCount = 0;
			graph.forEachNode(() => {
				nodeCount++;
			});

			lastPos = new Map();
			graph.forEachNode((id, attrs) => {
				lastPos!.set(Number(id), { x: attrs.x, y: attrs.y });
			});

			if (callbacks.onLayoutTick) {
				callbacks.onLayoutTick({
					timestamp: Date.now(),
					meanDisplacement: meanMoved,
					maxDisplacement: maxMoved,
					stdDisplacement: stdMoved,
					kineticEnergy,
					nodeCount,
				});
			}

			statsTimer = setTimeout(tick, STATS_POLL_MS);
		};
		tick();
	}

	function stopTimers(): void {
		if (saveTimer) {
			clearInterval(saveTimer);
			saveTimer = null;
		}
		if (statsTimer) {
			clearTimeout(statsTimer);
			statsTimer = null;
		}
	}

	function dispose(): void {
		stopTimers();
		if (layout) {
			layout.kill();
			layout = null;
		}
	}

	return { start, stop, dispose };
}