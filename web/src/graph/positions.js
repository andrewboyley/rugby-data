// Layout-position persistence. Node positions are stored under local
//Storage so the graph does not have to re-learn its layout from random seeds
// on every reload.

const POSITIONS_KEY = "rugby-graph-positions";

export function createPositionStore(map = new Map()) {
	const positions = map;

	function load() {
		try {
			const raw = localStorage.getItem(POSITIONS_KEY);
			if (!raw) return;
			const obj = JSON.parse(raw);
			for (const key in obj) positions.set(Number(key), obj[key]);
		} catch {
			/* ignore corrupt/unavailable storage */
		}
	}

	function save() {
		try {
			const obj = {};
			for (const [id, pos] of positions) obj[id] = { x: pos.x, y: pos.y };
			localStorage.setItem(POSITIONS_KEY, JSON.stringify(obj));
		} catch {
			/* ignore quota/unavailable storage */
		}
	}

	// Snapshot the graph's current positions into the store (and storage).
	function capture(graph) {
		if (!graph) return;
		graph.forEachNode((id, attrs) => {
			positions.set(Number(id), { x: attrs.x, y: attrs.y });
		});
	}

	function persist(graph) {
		capture(graph);
		save();
	}

	// Adopt a seed layout (e.g. the circular ring from "Rebuild Layout").
	// Seed keys are node-id strings; the store is keyed by numeric id
	// (buildGraph lookup + capture convention).
	function replaceSeed(seedPositions) {
		positions.clear();
		for (const [key, value] of Object.entries(seedPositions)) {
			positions.set(Number(key), value);
		}
	}

	return { positions, load, save, capture, persist, replaceSeed };
}