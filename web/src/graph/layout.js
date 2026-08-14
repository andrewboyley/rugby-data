// ForceAtlas-2 layout management. FA2's worker runs until stop() is called —
// there is no built-in "settled" signal — so the manager polls node movement
// each tick and stops the worker once positions stop changing (or a hard
// timeout elapses). Positions are persisted to storage on a slow interval.

import forceAtlas2 from "graphology-layout-forceatlas2";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import { circular } from "graphology-layout";

const POSITION_SAVE_INTERVAL_MS = 60000;
const SETTLED_TICK_MS = 50;
const SETTLE_EPSILON = 1;
const SETTLE_TICKS = 10;
const MAX_WAIT_MS = 30000;

const LAYOUT_SETTINGS = {
	gravity: 0.5,
	slowDown: 50,
	// barnesHutOptimize: true,
	// edgeWeightInfluence: 1,
	// adjustSizes: true,
	// linLogMode: true,
};

export function circularSeed(graph) {
	return circular(graph, { scale: 100 });
}

export function createLayoutManager({ graph, onNodeMove, onSettled }) {
	let layout = null;
	let saveTimer = null;
	let settleTimer = null;

	function start() {
		if (layout) layout.kill();
		const current = new FA2Layout(graph, {
			settings: { ...forceAtlas2.inferSettings(graph), ...LAYOUT_SETTINGS },
		});
		layout = current;
		current.start();
		stopTimers();
		// The graph mutates node attributes during the layout; persist a
		// snapshot every so often so a reload resumes near the current layout.
		saveTimer = setInterval(onNodeMove, POSITION_SAVE_INTERVAL_MS);
		pollSettlement(current);
	}

	// Poll node movement each tick; once positions stop changing, stop the
	// worker and let the caller frame the view. Stillness is gated on the
	// worker actually having produced updates (`eachNodeAttributesUpdated`):
	// before the first worker round-trip the graph is trivially "still", so
	// counting that as settlement would stop a large graph during its first
	// update. When a previously-settled layout is resumed (positions persisted),
	// the worker keeps emitting updates while moving nodes by < SETTLE_EPSILON,
	// so the counter advances there too instead of sitting out MAX_WAIT_MS.
	function pollSettlement(current) {
		let lastPos = null;
		let still = 0;
		let sawUpdate = false;
		const t0 = performance.now();
		const onNodeUpdate = () => {
			sawUpdate = true;
		};
		graph.on("eachNodeAttributesUpdated", onNodeUpdate);
		const tick = () => {
			if (layout !== current || !current.isRunning()) return;
			let moved = 0;
			if (lastPos) {
				graph.forEachNode((id, attrs) => {
					const prev = lastPos.get(Number(id));
					if (prev) moved = Math.max(moved, Math.hypot(attrs.x - prev.x, attrs.y - prev.y));
				});
			}
			lastPos = new Map();
			graph.forEachNode((id, attrs) => lastPos.set(Number(id), { x: attrs.x, y: attrs.y }));
			if (moved >= SETTLE_EPSILON) {
				still = 0;
			} else if (sawUpdate) {
				still++;
			}

			if (still >= SETTLE_TICKS || performance.now() - t0 > MAX_WAIT_MS) {
				stopTimers();
				graph.removeListener("eachNodeAttributesUpdated", onNodeUpdate);
				if (layout === current && current.isRunning()) current.stop();
				onSettled();
				return;
			}
			settleTimer = setTimeout(tick, SETTLED_TICK_MS);
		};
		tick();
	}

	function stopTimers() {
		if (saveTimer) {
			clearInterval(saveTimer);
			saveTimer = null;
		}
		if (settleTimer) {
			clearTimeout(settleTimer);
			settleTimer = null;
		}
	}

	// Detach the worker and timers; the layout can be restarted afterwards.
	function dispose() {
		stopTimers();
		if (layout) {
			layout.kill();
			layout = null;
		}
	}

	return { start, dispose };
}