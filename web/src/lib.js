// Build node/link structures from graph.json and compute the visible
// subset for the current filters.

export function parseGraph(g) {
  const players = Object.fromEntries(
    Object.entries(g.players || {}).map(([k, v]) => [Number(k), v]));
  const appearances = Object.fromEntries(
    Object.entries(g.appearances || {}).map(([k, v]) => [Number(k), Number(v)]));
  const playerTeams = Object.fromEntries(
    Object.entries(g.playerTeams || {}).map(([k, v]) => [Number(k), Number(v)]));

  const nodes = Object.entries(appearances).map(([id, app]) => ({
    id: Number(id),
    name: players[Number(id)] || String(id),
    team: playerTeams[Number(id)] ?? null,
    app,
    deg: 0,
    globalDeg: 0,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = (g.edges || [])
    .map((e) => {
      const a = byId.get(e.playerA);
      const b = byId.get(e.playerB);
      return a && b ? { source: a, target: b, w: e.weight } : null;
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

// Restrict to one team (when set), compute degrees within that subset, then
// apply the min-weight and max-degree filters. Pure: returns fresh node/link
// objects so it is safe to call from a $derived. Matches nodes by ID, never
// by object reference (Svelte reactive proxies do not preserve identity).
export function visibleSubset(nodes, links, minW, maxD, team) {
  const nodeSet = team == null ? nodes : nodes.filter((n) => n.team === team);
  const inSet = new Set(nodeSet.map((n) => n.id));
  const deg = new Map();
  const kept = [];
  for (const l of links) {
    if (inSet.has(l.source.id) && inSet.has(l.target.id)) {
      deg.set(l.source.id, (deg.get(l.source.id) || 0) + 1);
      deg.set(l.target.id, (deg.get(l.target.id) || 0) + 1);
      kept.push(l);
    }
  }
  const ls = kept.filter((l) =>
    l.w >= minW &&
    (deg.get(l.source.id) || 0) <= maxD &&
    (deg.get(l.target.id) || 0) <= maxD);
  const keep = new Set();
  for (const l of ls) {
    keep.add(l.source.id);
    keep.add(l.target.id);
  }
  const out = nodeSet.filter((n) => keep.has(n.id))
    .map((n) => ({ ...n, deg: deg.get(n.id) || 0 }));
  const byId = new Map(out.map((n) => [n.id, n]));
  const outLinks = ls.map((l) => ({
    source: byId.get(l.source.id),
    target: byId.get(l.target.id),
    w: l.w,
  }));
  return { nodes: out, links: outLinks };
}
