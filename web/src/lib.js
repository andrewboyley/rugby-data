// Build node/link structures from graph.gexf XML and compute the visible
// subset for the current filters.

export function parseGraph(text) {
	const parser = new DOMParser();
	const doc = parser.parseFromString(text, "application/xml");

	const keywordsEl = doc.getElementsByTagName("keywords")[0];
	let meta = {};
	if (keywordsEl && keywordsEl.textContent) {
		try {
			meta = JSON.parse(keywordsEl.textContent.trim());
		} catch (e) {
			console.error("Failed to parse GEXF keywords metadata", e);
		}
	}

	const players = Object.fromEntries(
		Object.entries(meta.players || {}).map(([k, v]) => [Number(k), v]),
	);
	const appearances = Object.fromEntries(
		Object.entries(meta.appearances || {}).map(([k, v]) => [Number(k), Number(v)]),
	);
	const playerTeams = Object.fromEntries(
		Object.entries(meta.playerTeams || {}).map(([k, v]) => [Number(k), Number(v)]),
	);
	const playerJersey = Object.fromEntries(
		Object.entries(meta.playerJersey || {}).map(([k, v]) => [Number(k), Number(v)]),
	);
	const playerDates = Object.fromEntries(
		Object.entries(meta.playerDates || {}).map(([k, v]) => [Number(k), v.slice().sort()]),
	);

	// Fallback: parse nodes from DOM if metadata keywords is missing
	if (Object.keys(appearances).length === 0) {
		const nodeEls = doc.getElementsByTagName("node");
		for (const nEl of nodeEls) {
			const id = Number(nEl.getAttribute("id"));
			const label = nEl.getAttribute("label");
			players[id] = label;
			appearances[id] = 1;
			const atts = nEl.getElementsByTagName("attvalue");
			for (const att of atts) {
				const attrFor = att.getAttribute("for");
				const val = att.getAttribute("value");
				if (attrFor === "app") appearances[id] = Number(val);
				if (attrFor === "team") playerTeams[id] = Number(val);
				if (attrFor === "jersey") playerJersey[id] = Number(val);
				if (attrFor === "dates") playerDates[id] = val ? val.split(",") : [];
			}
		}
	}

	const nodes = Object.entries(appearances).map(([id, app]) => ({
		id: Number(id),
		name: players[Number(id)] || String(id),
		team: playerTeams[Number(id)] ?? null,
		jersey: playerJersey[Number(id)] ?? null,
		app,
		dates: playerDates[Number(id)] || [],
		deg: 0,
		globalDeg: 0,
	}));
	const byId = new Map(nodes.map((n) => [n.id, n]));

	let rawEdges = meta.edges || [];
	if (rawEdges.length === 0) {
		const edgeEls = doc.getElementsByTagName("edge");
		for (const eEl of edgeEls) {
			const source = Number(eEl.getAttribute("source"));
			const target = Number(eEl.getAttribute("target"));
			let weight = Number(eEl.getAttribute("weight") || 1);
			let dates = [];
			const atts = eEl.getElementsByTagName("attvalue");
			for (const att of atts) {
				const attrFor = att.getAttribute("for");
				const val = att.getAttribute("value");
				if (attrFor === "weight") weight = Number(val);
				if (attrFor === "dates") dates = val ? val.split(",") : [];
			}
			rawEdges.push({ playerA: source, playerB: target, weight, dates });
		}
	}

	const links = rawEdges
		.map((e) => {
			const a = byId.get(e.playerA);
			const b = byId.get(e.playerB);
			return a && b
				? { source: a, target: b, w: e.weight, dates: (e.dates || []).slice().sort() }
				: null;
		})
		.filter(Boolean);

	for (const l of links) {
		l.source.globalDeg++;
		l.target.globalDeg++;
	}
	const maxGlobalDeg = Math.max(0, ...nodes.map((n) => n.globalDeg)) || 1;

	const teams = meta.teams || {};
	const dateMin = meta.dateMin || null;
	const dateMax = meta.dateMax || null;

	return { nodes, links, teams, maxGlobalDeg, dateMin, dateMax };
}

// Stable key for an undirected edge, independent of endpoint order.
export function edgeKey(a, b) {
	return a < b ? `${a},${b}` : `${b},${a}`;
}

// Map a win rate in [0,1] to a colour on a red (loss) -> amber -> green (win)
// ramp.
export function winRateColor(p) {
	const stops = [
		[0.0, [196, 61, 55]],
		[0.5, [230, 180, 66]],
		[1.0, [46, 168, 95]],
	];
	p = Math.max(0, Math.min(1, p));
	for (let i = 1; i < stops.length; i++) {
		if (p <= stops[i][0]) {
			const [x0, c0] = stops[i - 1];
			const [x1, c1] = stops[i];
			const t = (p - x0) / (x1 - x0);
			const rgb = c0.map((v, k) =>
				Math.round(v + (c1[k] - v) * t)
					.toString(16)
					.padStart(2, "0"),
			);
			return "#" + rgb.join("");
		}
	}
	return "#2ea85f";
}

export function teamName(teams, tid) {
	if (tid == null) return "";
	return teams[tid] || `team ${tid}`;
}

// Restrict to one team (when set) and a date window, compute weights and
// degrees within that subset, then apply the min-weight and max-degree
// filters. Pure: returns fresh node/link objects so it is safe to call from a
// $derived. Matches nodes by ID, never by object reference (Svelte reactive
// proxies do not preserve identity).
export function visibleSubset(nodes, links, minW, maxW, maxD, team, dateStart, dateEnd, prevPos) {
	let lo = dateStart,
		hi = dateEnd;
	if (lo && hi && lo > hi) {
		const swap = lo;
		lo = hi;
		hi = swap;
	}
	const inRange = (d) => d && (!lo || d >= lo) && (!hi || d <= hi);
	const nodeSet = team == null ? nodes : nodes.filter((n) => n.team === team);
	const inSet = new Set(nodeSet.map((n) => n.id));

	const app = new Map();
	for (const n of nodeSet) {
		app.set(n.id, n.dates.length ? n.dates.filter(inRange).length : n.app);
	}

	const deg = new Map();
	const kept = [];
	for (const l of links) {
		if (inSet.has(l.source.id) && inSet.has(l.target.id)) {
			const w = l.dates.length ? l.dates.filter(inRange).length : l.w;
			if (w === 0) continue;
			deg.set(l.source.id, (deg.get(l.source.id) || 0) + 1);
			deg.set(l.target.id, (deg.get(l.target.id) || 0) + 1);
			kept.push({ l, w });
		}
	}
	const wLo = Math.min(minW, maxW),
		wHi = Math.max(minW, maxW);
	const ls = kept.filter(
		({ l, w }) =>
			w >= wLo &&
			w <= wHi &&
			(deg.get(l.source.id) || 0) <= maxD &&
			(deg.get(l.target.id) || 0) <= maxD,
	);
	const keep = new Set();
	for (const { l } of ls) {
		keep.add(l.source.id);
		keep.add(l.target.id);
	}
	const out = nodeSet
		.filter((n) => keep.has(n.id))
		.map((n) => {
			const p = prevPos && prevPos.get(n.id);
			const node = { ...n, deg: deg.get(n.id) || 0, app: app.get(n.id) || 0 };
			if (p) {
				node.x = p.x;
				node.y = p.y;
			}
			return node;
		});
	const byId = new Map(out.map((n) => [n.id, n]));
	const outLinks = ls.map(({ l, w }) => ({
		source: byId.get(l.source.id),
		target: byId.get(l.target.id),
		w,
		dates: l.dates.length ? l.dates.filter(inRange) : [],
	}));
	return { nodes: out, links: outLinks };
}
