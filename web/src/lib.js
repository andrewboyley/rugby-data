// Build node/link structures from graph.json and compute the visible
// subset for the current filters.

export function parseGraph(g) {
  const players = Object.fromEntries(
    Object.entries(g.players || {}).map(([k, v]) => [Number(k), v]));
  const appearances = Object.fromEntries(
    Object.entries(g.appearances || {}).map(([k, v]) => [Number(k), Number(v)]));
  const playerTeams = Object.fromEntries(
    Object.entries(g.playerTeams || {}).map(([k, v]) => [Number(k), Number(v)]));
  const playerJersey = Object.fromEntries(
    Object.entries(g.playerJersey || {}).map(([k, v]) => [Number(k), Number(v)]));
  const playerDates = Object.fromEntries(
    Object.entries(g.playerDates || {}).map(([k, v]) => [Number(k), v.slice().sort()]));

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
  const links = (g.edges || [])
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
  const maxGlobalDeg =
    Math.max(0, ...nodes.map((n) => n.globalDeg)) || 1;

  return { nodes, links, teams: g.teams || {}, maxGlobalDeg };
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
export function visibleSubset(nodes, links, minW, maxD, team, dateStart, dateEnd, prevPos) {
  let lo = dateStart, hi = dateEnd;
  if (lo && hi && lo > hi) { const swap = lo; lo = hi; hi = swap; }
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
  const ls = kept.filter(({ l, w }) =>
    w >= minW &&
    (deg.get(l.source.id) || 0) <= maxD &&
    (deg.get(l.target.id) || 0) <= maxD);
  const keep = new Set();
  for (const { l } of ls) {
    keep.add(l.source.id);
    keep.add(l.target.id);
  }
  const out = nodeSet.filter((n) => keep.has(n.id))
    .map((n) => {
      const p = prevPos && prevPos.get(n.id);
      const node = { ...n, deg: deg.get(n.id) || 0, app: app.get(n.id) || 0 };
      if (p) { node.x = p.x; node.y = p.y; }
      return node;
    });
  const byId = new Map(out.map((n) => [n.id, n]));
  const outLinks = ls.map(({ l, w }) => ({
    source: byId.get(l.source.id),
    target: byId.get(l.target.id),
    w,
  }));
  return { nodes: out, links: outLinks };
}
