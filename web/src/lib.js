// Build node/link structures from graph.json and compute the visible
// subset for the current filters.

export function parseGraph(text) {
    const data = JSON.parse(text);

    const players = Object.fromEntries(
        Object.entries(data.players || {}).map(([k, v]) => [Number(k), v]),
    );
    const appearances = Object.fromEntries(
        Object.entries(data.appearances || {}).map(([k, v]) => [Number(k), Number(v)]),
    );
    const playerTeams = Object.fromEntries(
        Object.entries(data.playerTeams || {}).map(([k, v]) => [Number(k), Array.isArray(v) ? v.map(Number) : [Number(v)]]),
    );
    const playerTeamDates = Object.fromEntries(
        Object.entries(data.playerTeamDates || {}).map(([k, v]) => [
            Number(k),
            Object.fromEntries(
                Object.entries(v).map(([tk, tv]) => [Number(tk), tv.slice().sort()])
            ),
        ]),
    );
    const playerJersey = Object.fromEntries(
        Object.entries(data.playerJersey || {}).map(([k, v]) => [Number(k), Number(v)]),
    );
    const playerDates = Object.fromEntries(
        Object.entries(data.playerDates || {}).map(([k, v]) => [Number(k), v.slice().sort()]),
    );

    const nodes = Object.entries(appearances).map(([id, app]) => {
        const teams = playerTeams[Number(id)] ?? [];
        const teamId = teams[0] ?? null;
        return {
            id: Number(id),
            name: players[Number(id)] || String(id),
            team: teamId,
            teams,
            jersey: playerJersey[Number(id)] ?? null,
            app,
            dates: playerDates[Number(id)] || [],
            deg: 0,
            globalDeg: 0,
        };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));

    const links = (data.edges || [])
        .map((e) => {
            const a = byId.get(e.playerA);
            const b = byId.get(e.playerB);
            return a && b
                ? { source: a, target: b, w: e.weight, recency: e.recency ?? 0.5, dates: (e.dates || []).slice().sort() }
                : null;
        })
        .filter(Boolean);

    for (const l of links) {
        l.source.globalDeg++;
        l.target.globalDeg++;
    }
    const maxGlobalDeg = Math.max(0, ...nodes.map((n) => n.globalDeg)) || 1;

    const teams = data.teams || {};
    const dateMin = data.dateMin || null;
    const dateMax = data.dateMax || null;
    const winRates = new Map(Object.entries(data.winRates || {}));

    return { nodes, links, teams, maxGlobalDeg, dateMin, dateMax, winRates, games: data.games || [], playerTeamDates };
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
	const t = teams[tid];
	if (!t) return `team ${tid}`;
	return typeof t === "string" ? t : t.name;
}

// Restrict to one team (when set) and a date window, compute weights and
// degrees within that subset, then apply the min-weight and max-degree
// filters. Pure: returns fresh node/link objects so it is safe to call from a
// $derived. Matches nodes by ID, never by object reference (Svelte reactive
// proxies do not preserve identity).
export function visibleSubset(nodes, links, minW, maxW, minD, maxD, dateStart, dateEnd, prevPos, playerTeamDates, matchPlayers = null, matchTeamOf = null) {
	let lo = dateStart,
		hi = dateEnd;
	if (lo && hi && lo > hi) {
		const swap = lo;
		lo = hi;
		hi = swap;
	}
	const inRange = (d) => d && (!lo || d >= lo) && (!hi || d <= hi);
	const nodeSet = matchPlayers ? nodes.filter((n) => matchPlayers.has(n.id)) : nodes;
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
	const dLo = Math.min(minD, maxD),
		dHi = Math.max(minD, maxD);
	const ls = kept.filter(
		({ l, w }) =>
			w >= wLo &&
			w <= wHi &&
			(deg.get(l.source.id) || 0) >= dLo &&
			(deg.get(l.source.id) || 0) <= dHi &&
			(deg.get(l.target.id) || 0) >= dLo &&
			(deg.get(l.target.id) || 0) <= dHi,
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
				if (matchTeamOf && matchTeamOf.has(n.id)) {
					// Inside a focused match every participant wears their side's
					// colours/label for that game. node.teams is a recency-sorted
					// list of every team the player has ever played for, whose
					// first entry (most recent) is wrong when a player later
					// switched sides (e.g. France -> Fiji): without this pin the
					// player would render under the wrong cluster label.
					node.teams = [matchTeamOf.get(n.id)];
					node.team = matchTeamOf.get(n.id);
				} else if (playerTeamDates && playerTeamDates[n.id]) {
					const dates_by_team = playerTeamDates[n.id];
					node.teams = node.teams.filter((tid) =>
						(dates_by_team[tid] || []).some(inRange),
					);
					node.team = node.teams[0] ?? null;
				}
			if (p) {
				node.x = p.x;
				node.y = p.y;
			}
			return node;
		});
	const byId = new Map(out.map((n) => [n.id, n]));
	let winMin = lo,
		winMax = hi;
	for (const { l } of kept) {
		const ds = l.dates.length ? l.dates.filter(inRange) : l.dates;
		for (const d of ds) {
			if (winMin == null || d < winMin) winMin = d;
			if (winMax == null || d > winMax) winMax = d;
		}
	}
	const spanDays = winMin != null && winMax != null ? (Date.parse(winMax) - Date.parse(winMin)) / 864e5 : 0;
	const raw = ls.map(({ l, w }) => {
		const dates = l.dates.length ? l.dates.filter(inRange) : [];
		let rec = l.recency ?? 0.5;
		if (spanDays > 0 && dates.length) {
			const latest = dates[dates.length - 1];
			rec = Math.max(0, Math.min(1, (Date.parse(latest) - Date.parse(winMin)) / 864e5 / spanDays));
		}
		return { l, w, dates, rec };
	});
	let rMin = Infinity,
		rMax = -Infinity;
	for (const { rec } of raw) {
		if (rec < rMin) rMin = rec;
		if (rec > rMax) rMax = rec;
	}
	const span = rMax - rMin || 1;
	const outLinks = raw.map(({ l, w, dates, rec }) => ({
		source: byId.get(l.source.id),
		target: byId.get(l.target.id),
		w,
		recency: rMin === rMax ? 1 : (rec - rMin) / span,
		dates,
	}));
	return { nodes: out, links: outLinks };
}
