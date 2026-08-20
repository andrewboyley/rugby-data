// Core data layer: parsing, filtering, and shared pure utilities.
// winRateColor and teamName are canonical — imported by graph modules
// and Svelte components to avoid duplication.

import type {
  RawGraphData,
  ParsedGraph,
  ParsedGraphData,
  Player,
  Coach,
  GraphNode as Node,
  Link,
  Filters,
  ViewResult,
  RawTeamInfo,
  Game,
} from "./types.ts";

// ---- JSON parsing ----

// Jersey colour ramp (positions 1-23): shared by the legend, pane highlights
// and the match player info, so all render consistently.
export const JERSEY_COLORS = [
  "#23171b", "#453390", "#4a52d4", "#4172f3", "#3491f8",
  "#29afeb", "#25cad4", "#2bdfb7", "#3af099", "#53fa7d",
  "#73fe64", "#96fa50", "#baf040", "#dae034", "#f3c92b",
  "#ffae25", "#ff9020", "#ff701a", "#eb5015", "#d0330e",
  "#b21c06", "#990e00", "#900d00",
];

export function parseGraph(text: string): ParsedGraph {
  const data: RawGraphData = JSON.parse(text);

  // Player IDs in the source data may be numeric or UUID strings. The web
  // model assumes stable integer IDs, so normalise every raw ID to a unique
  // integer: numeric IDs keep their value, non-numeric IDs get a fresh
  // integer from a high range (avoiding collision with real numeric IDs).
  const idMap = new Map<string, number>();
  let autoId = 1_000_000;
  const normId = (raw: unknown): number => {
    const key = String(raw);
    const existing = idMap.get(key);
    if (existing !== undefined) return existing;
    const id = /^\d+$/.test(key) ? Number(key) : autoId++;
    idMap.set(key, id);
    return id;
  };

  const players: Record<number, string> = {};
  for (const [k, v] of Object.entries(data.players ?? {})) {
    players[normId(k)] = v as string;
  }
  const appearances: Record<number, number> = {};
  for (const [k, v] of Object.entries(data.appearances ?? {})) {
    appearances[normId(k)] = Number(v);
  }
  const playerTeams: Record<number, number[]> = {};
  for (const [k, v] of Object.entries(data.playerTeams ?? {})) {
    playerTeams[normId(k)] = Array.isArray(v) ? (v as unknown[]).map(Number) : [Number(v)];
  }
  const playerTeamDates: Map<number, Map<number, string[]>> = new Map();
  for (const [k, v] of Object.entries(data.playerTeamDates ?? {})) {
    const inner = new Map<number, string[]>();
    for (const [tk, tv] of Object.entries(v as Record<string, string[]>)) {
      inner.set(Number(tk), (tv as string[]).slice().sort());
    }
    playerTeamDates.set(normId(k), inner);
  }
  const playerJersey: Record<number, number> = {};
  for (const [k, v] of Object.entries(data.playerJersey ?? {})) {
    playerJersey[normId(k)] = Number(v);
  }
  const playerDates: Record<number, string[]> = {};
  for (const [k, v] of Object.entries(data.playerDates ?? {})) {
    playerDates[normId(k)] = (v as string[]).slice().sort();
  }

  // Parse coach data
  const coachDates: Record<string, string[]> = data.coachDates ?? {};
  const coachTeams: Record<string, number[]> = data.coachTeams ?? {};
  const coachNames: Record<string, string> = data.coaches ?? {};

  // Coaches whose id is c_<id> where <id> also exists as a roster player are
  // data pollution: the coach was listed in the playing squad. Merge those
  // coaches into the player node so we don't get two nodes for one person.
  // <id> may be numeric (c_197) or a UUID (c_c48b859f-…) — both handled by
  // stripping the c_ prefix and checking for a matching player.
  const coachNodes: Coach[] = [];
  const coachById = new Map<number, Node>();
  const coachOrigToNorm = new Map<string, number>();
  const mergedCoachIds = new Map<number, number>(); // norm coach id -> twin player id
  for (const [cid, app] of Object.entries(data.coachAppearances ?? {})) {
    const normCid = normId(cid);
    coachOrigToNorm.set(cid, normCid);
    const m = /^c_(.+)$/.exec(cid);
    if (m && (appearances[normId(m[1])] ?? 0) > 0) {
      mergedCoachIds.set(normCid, normId(m[1]));
      continue;
    }
    const teams = coachTeams[cid] ?? [];
    const node: Coach = {
      id: normCid,
      name: coachNames[cid.replace(/^c_/, "")] ?? cid,
      team: teams[0] ?? null,
      teams,
      app,
      dates: coachDates[cid] ?? [],
      deg: 0,
      globalDeg: 0,
      isCoach: true,
    };
    coachNodes.push(node);
    coachById.set(normCid, node);
  }

  // Parse coach-team dates (keys are original string coach IDs)
  const coachTeamDates: Map<number, Map<number, string[]>> = new Map();
  for (const [k, v] of Object.entries(data.coachTeamDates ?? {})) {
    const inner = new Map<number, string[]>();
    for (const [tk, tv] of Object.entries(v as Record<string, string[]>)) {
      inner.set(Number(tk), (tv as string[]).slice().sort());
    }
    const normKid = coachOrigToNorm.get(k);
    if (normKid != null) coachTeamDates.set(normKid, inner);
  }

  const nodes: Player[] = [];
  const byId = new Map<number, Player>();
  for (const [idStr, app] of Object.entries(appearances)) {
    const id = Number(idStr);
    const teams = playerTeams[id] ?? [];
    const node: Player = {
      id,
      name: players[id] ?? String(id),
      team: teams[0] ?? null,
      teams,
      jersey: playerJersey[id] ?? null,
      app,
      dates: playerDates[id] ?? [],
      deg: 0,
      globalDeg: 0,
      isCoach: false,
    };
    nodes.push(node);
    byId.set(id, node);
  }

  // Re-point merged coaches at their twin player nodes so coach edges
  // resolve onto the single (player) node.
  for (const [normCid, twin] of mergedCoachIds) {
    const twinNode = byId.get(twin);
    if (twinNode) coachById.set(normCid, twinNode);
  }

  // Combine player and coach nodes
  const allNodes: Node[] = [...nodes, ...coachNodes];

  const links: Link[] = [];
  // Person-level pair resolution: a coach norm-id for a twin maps back to the
  // player id, and a player id for a twin maps to its coach norm-id. Two raw
  // pairs (e.g. (c_197, c_2531) and (c_197, 2531)) can be the same person
  // pair, so every pair key is built from resolved ids.
  const person = (id: number) => (mergedCoachIds.get(id) ?? id);

  // Coach-player pairs: a player edge for the same person pair is a coach
  // squad artifact (the coach id also appears in the roster), so it is dropped
  // in favour of the separate coach edge. Real playing-era edges for a twin
  // share no coach pair and stay.
  const coachPairs = new Set<string>();
  for (const e of data.coachEdges ?? []) {
    coachPairs.add(edgeKey(person(normId(e.coachA)), person(normId(e.coachB))));
  }
  for (const e of data.edges ?? []) {
    const a = byId.get(normId(e.playerA));
    const b = byId.get(normId(e.playerB));
    if (!a || !b) continue;
    if (coachPairs.has(edgeKey(a.id, b.id))) continue;
    links.push({
      source: a,
      target: b,
      w: e.weight,
      recency: e.recency ?? 0.5,
      dates: (e.dates ?? []).slice().sort(),
    });
  }

  // Coach-Coach and Coach-Player edges, deduped at person-pair level.
  const addedCoachPairs = new Set<string>();
  for (const e of data.coachEdges ?? []) {
    const a = normId(e.coachA);
    const b = normId(e.coachB);
    const nodeA = coachById.has(a) ? coachById.get(a) : byId.get(a);
    const nodeB = coachById.has(b) ? coachById.get(b) : byId.get(b);
    if (!nodeA || !nodeB || nodeA === nodeB) continue;
    const key = edgeKey(nodeA.id, nodeB.id);
    if (addedCoachPairs.has(key)) continue;
    addedCoachPairs.add(key);
    links.push({
      source: nodeA!,
      target: nodeB!,
      w: e.weight,
      recency: e.recency ?? 0.5,
      dates: (e.dates ?? []).slice().sort(),
      coach: true,
    });
  }

  for (const l of links) {
    l.source.globalDeg++;
    l.target.globalDeg++;
  }
  const maxGlobalDeg = Math.max(1, ...allNodes.map((n) => n.globalDeg));

  const teams: Record<number, RawTeamInfo> = {};
  for (const [k, v] of Object.entries(data.teams ?? {})) {
    teams[Number(k)] = v as RawTeamInfo;
  }

  const winRates = new Map<string, number>();
  for (const [k, v] of Object.entries(data.winRates ?? {})) {
    const [a, b] = k.split(",");
    // edgeKey sorts numerically; coach ids (high auto ids) may come first in
    // the raw key, so normalise to the sorted order before storing.
    winRates.set(edgeKey(normId(a), normId(b)), v as number);
  }

  const games = (data.games ?? []).map((g) => ({
    ...g,
    competitors: (g.competitors ?? []).map((c) => {
      const rawCoachId = (c as unknown as { coachId?: string | null }).coachId;
      let coachNodeId: number | null = null;
      if (rawCoachId) {
        const normCid = normId("c_" + rawCoachId);
        // A coach who was also a roster player merges into their player node;
        // point the game's coach ref at that same node.
        coachNodeId = mergedCoachIds.get(normCid) ?? normCid;
      }
      return {
        ...c,
        roster: (c.roster ?? []).map((e) => ({ ...e, playerId: normId(e.playerId) })),
        coachNodeId,
      };
    }),
  }));

  return {
    nodes,
    coachNodes,
    links,
    teams,
    maxGlobalDeg,
    dateMin: data.dateMin ?? null,
    dateMax: data.dateMax ?? null,
    winRates,
    games,
    playerTeamDates,
    coachTeamDates,
  };
}

// ---- Pure utilities ----

/** Stable undirected edge key, independent of endpoint order. */
export function edgeKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

/** Display name for a team, falling back to "team <id>". */
export function teamName(teams: Record<number, RawTeamInfo>, tid: number | null | undefined): string {
  if (tid == null) return "";
  const t = teams[tid];
  if (!t) return `team ${tid}`;
  return typeof t === "string" ? t : t.name;
}

/** Display abbreviation for a team, falling back to name, then "team <id>". */
export function teamAbbreviation(teams: Record<number, RawTeamInfo>, tid: number | null | undefined): string {
  if (tid == null) return "";
  const t = teams[tid];
  if (!t) return `team ${tid}`;
  if (typeof t === "string") return t;
  return t.abbreviation ?? t.name ?? `team ${tid}`;
}

/**
 * Free-text match search. The query is split into whitespace-separated
 * tokens; a game matches only if EVERY token appears somewhere in its
 * combined searchable text (date, both team names/abbreviations, scores,
 * venue name/city/country, league, and every roster player's name). Tokens
 * are matched as plain substrings, so "2024", "eng", "twickenham" or
 * "33-19" all work. Results are ranked by number of matching tokens, then
 * recency. With an empty query it returns the most recent games.
 */
export function searchGames(
  games: Game[],
  query: string,
  teams: Record<number, RawTeamInfo>,
  playerName: (id: number) => string,
): Game[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return games
      .filter((g) => g.date)
      .sort((a, b) => (a.date! < b.date! ? 1 : a.date! > b.date! ? -1 : 0))
      .slice(0, 20);
  }

  const results: { game: Game; score: number }[] = [];
  for (const g of games) {
    const parts: string[] = [];
    if (g.date) parts.push(g.date);

    const competitors = g.competitors ?? [];
    const scores: number[] = [];
    for (const c of competitors) {
      parts.push(teamName(teams, c.teamId));
      parts.push(teamAbbreviation(teams, c.teamId));
      if (c.score != null) {
        parts.push(String(c.score));
        scores.push(c.score);
      }
    }
    if (scores.length === 2) {
      parts.push(`${scores[0]}-${scores[1]}`);
      parts.push(`${scores[0]} ${scores[1]}`);
    }
    if (g.venue) {
      parts.push(g.venue.name ?? "", g.venue.city ?? "", g.venue.country ?? "");
    }
    if (g.league) {
      parts.push(g.league.name, g.league.abbreviation ?? "");
    }
    for (const c of competitors) {
      for (const e of c.roster ?? []) parts.push(playerName(e.playerId));
    }

    const haystack = parts.join("  ").toLowerCase();
    let matchedAll = true;
    let score = 0;
    for (const t of tokens) {
      if (haystack.includes(t)) score += 1;
      else {
        matchedAll = false;
        break;
      }
    }
    if (matchedAll) results.push({ game: g, score });
  }

  results.sort(
    (a, b) =>
      b.score - a.score ||
      (a.game.date! < b.game.date! ? 1 : a.game.date! > b.game.date! ? -1 : 0),
  );
  return results.map((r) => r.game);
}

// ---- Memoised visible subset ----

// Cache keyed by a structural hash of the inputs. The node/link arrays
// change only on graph rebuild; filter changes hit the cache when the
// structural inputs are unchanged.

type CacheKey = string;

interface CacheEntry {
  key: CacheKey;
  result: ViewResult;
}

const MAX_CACHE = 8;
const cache = new Map<CacheKey, CacheEntry>();

function makeKey(
  nodeCount: number,
  linkCount: number,
  filters: Filters,
  matchPlayers: Set<number> | null,
  matchTeamOf: Map<number, number> | null,
  matchCoaches: Set<number> | null,
): CacheKey {
  const parts: string[] = [
    String(nodeCount),
    String(linkCount),
    String(filters.minW),
    String(filters.minD),
    filters.dateStart ?? "",
    filters.dateEnd ?? "",
    String(filters.showCoaches),
  ];
  if (matchPlayers) {
    parts.push("mp:" + [...matchPlayers].sort((a, b) => a - b).join(","));
  }
  if (matchTeamOf) {
    parts.push("mt:" + [...matchTeamOf.entries()].sort((a, b) => a[0] - b[0]).map((e) => `${e[0]}=${e[1]}`).join(","));
  }
  if (matchCoaches) {
    parts.push("mc:" + [...matchCoaches].sort((a, b) => a - b).join(","));
  }
  return parts.join("|");
}

export function visibleSubset(
  nodes: Node[],
  links: Link[],
  filters: Filters,
  prevPos: Map<number, { x: number; y: number }>,
  playerTeamDates: Map<number, Map<number, string[]>>,
  matchPlayers: Set<number> | null = null,
  matchTeamOf: Map<number, number> | null = null,
  matchCoaches: Set<number> | null = null,
): ViewResult {
  const { minW, minD, dateStart, dateEnd, showCoaches } = filters;
  const key = makeKey(nodes.length, links.length, filters, matchPlayers, matchTeamOf, matchCoaches);
  const hit = cache.get(key);
  if (hit && hit.key === key) {
    // Shallow structural check: same node count and link count usually
    // means the arrays haven't been rebuilt (the only thing that changes
    // between filter drags on the same graph).
    return hit.result;
  }

  let lo = dateStart;
  let hi = dateEnd;
  if (lo && hi && lo > hi) {
    const swap = lo;
    lo = hi;
    hi = swap;
  }
  const inRange = (d: string) => d && (!lo || d >= lo) && (!hi || d <= hi);

  // Filter out coaches if not shown. In match view the match's own coaches
  // are always kept (they're part of the match, independent of the toggle).
  const filteredNodes =
    showCoaches || matchPlayers != null ? nodes : nodes.filter((n) => !n.isCoach);

  let nodeSet: Node[];
  if (matchPlayers) {
    nodeSet = filteredNodes.filter((n) =>
      n.isCoach ? (matchCoaches?.has(n.id) ?? false) : matchPlayers.has(n.id),
    );
  } else {
    nodeSet = filteredNodes;
  }
  const inSet = new Set(nodeSet.map((n) => n.id));

  // In-range appearances per node (for display, not filtering)
  const app = new Map<number, number>();
  for (const n of nodeSet) {
    app.set(n.id, n.dates.length ? n.dates.filter(inRange).length : n.app);
  }

  // Degree computation and weight filtering
  const deg = new Map<number, number>();
  const kept: Array<{ l: Link; w: number }> = [];
  for (const l of links) {
    if (!showCoaches && l.coach) continue;
    if (!inSet.has(l.source.id) || !inSet.has(l.target.id)) continue;
    const w = l.dates.length ? l.dates.filter(inRange).length : l.w;
    if (w === 0) continue;
    deg.set(l.source.id, (deg.get(l.source.id) || 0) + 1);
    deg.set(l.target.id, (deg.get(l.target.id) || 0) + 1);
    kept.push({ l, w });
  }

  const filtered = kept.filter(
    ({ l, w }) =>
      w >= minW &&
      (deg.get(l.source.id) || 0) >= minD &&
      (deg.get(l.target.id) || 0) >= minD,
  );

  const keep = new Set<number>();
  for (const { l } of filtered) {
    keep.add(l.source.id);
    keep.add(l.target.id);
  }

  const out = nodeSet
    .filter((n) => keep.has(n.id))
    .map((n) => {
      const p = prevPos.get(n.id);
      const node: Node = {
        ...n,
        deg: deg.get(n.id) || 0,
        app: app.get(n.id) || 0,
      };
      if (matchTeamOf && matchTeamOf.has(n.id)) {
        node.teams = [matchTeamOf.get(n.id)!];
        node.team = matchTeamOf.get(n.id)!;
      } else if (playerTeamDates) {
        const datesByTeam = playerTeamDates.get(n.id);
        if (datesByTeam) {
          node.teams = node.teams.filter((tid) =>
            (datesByTeam.get(tid) ?? []).some(inRange)
          );
          node.team = node.teams[0] ?? null;
        }
      }
      if (p) {
        node.x = p.x;
        node.y = p.y;
      }
      return node;
    });

  const byId = new Map(out.map((n) => [n.id, n]));

  // Win-rate date range
  let winMin: string | null = lo;
  let winMax: string | null = hi;
  for (const { l } of kept) {
    const ds = l.dates.length ? l.dates.filter(inRange) : l.dates;
    for (const d of ds) {
      if (winMin == null || d < winMin) winMin = d;
      if (winMax == null || d > winMax) winMax = d;
    }
  }

  const spanDays =
    winMin != null && winMax != null
      ? (Date.parse(winMax) - Date.parse(winMin)) / 864e5
      : 0;

  const raw: Array<{ l: Link; w: number; dates: string[]; rec: number }> = [];
  for (const { l, w } of filtered) {
    const dates = l.dates.length ? l.dates.filter(inRange) : [];
    let rec = l.recency ?? 0.5;
    if (spanDays > 0 && dates.length) {
      const latest = dates[dates.length - 1]!;
      rec = Math.max(
        0,
        Math.min(1, (Date.parse(latest) - Date.parse(winMin!)) / 864e5 / spanDays)
      );
    }
    raw.push({ l, w, dates, rec });
  }

  let rMin = Infinity;
  let rMax = -Infinity;
  for (const { rec } of raw) {
    if (rec < rMin) rMin = rec;
    if (rec > rMax) rMax = rec;
  }
  const span = rMax - rMin || 1;

  const outLinks = raw.map(({ l, w, dates, rec }) => ({
    source: byId.get(l.source.id)!,
    target: byId.get(l.target.id)!,
    w,
    recency: rMin === rMax ? 1 : (rec - rMin) / span,
    dates,
  }));

  const result: ViewResult = { nodes: out, links: outLinks };

  // Cache eviction
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value!;
    cache.delete(first);
  }
  cache.set(key, { key, result });

  return result;
}

/** Clear the visible-subset cache. Call after graph rebuilds. */
export function clearSubsetCache(): void {
  cache.clear();
}

/** Reconstruct ParsedGraph from worker-serializable ParsedGraphData. */
export function hydrateParsedGraph(data: ParsedGraphData): ParsedGraph {
  const playerTeamDates = new Map<number, Map<number, string[]>>();
  for (const [pid, inner] of Object.entries(data.playerTeamDates)) {
    const m = new Map<number, string[]>();
    for (const [tid, dates] of Object.entries(inner)) {
      m.set(Number(tid), dates);
    }
    playerTeamDates.set(Number(pid), m);
  }

  const coachTeamDates = new Map<number, Map<number, string[]>>();
  for (const [cid, inner] of Object.entries(data.coachTeamDates)) {
    const m = new Map<number, string[]>();
    for (const [tid, dates] of Object.entries(inner)) {
      m.set(Number(tid), dates);
    }
    coachTeamDates.set(Number(cid), m);
  }

  const winRates = new Map<string, number>();
  for (const [pid, rate] of Object.entries(data.winRates)) {
    winRates.set(pid, rate);
  }

  // Build node lookup for link resolution
  const allNodes = new Map<number, Node>();
  for (const n of data.nodes) allNodes.set(n.id, n);
  for (const n of data.coachNodes) allNodes.set(n.id, n);

  // Convert serializable links to full Link objects with Node references
  const links: Link[] = data.links.map(l => ({
    source: allNodes.get(l.source)!,
    target: allNodes.get(l.target)!,
    w: l.w,
    recency: l.recency,
    dates: l.dates,
    coach: l.coach,
  }));

  return {
    nodes: data.nodes,
    coachNodes: data.coachNodes,
    links,
    teams: data.teams,
    maxGlobalDeg: data.maxGlobalDeg,
    dateMin: data.dateMin,
    dateMax: data.dateMax,
    winRates,
    games: data.games,
    playerTeamDates,
    coachTeamDates,
  };
}