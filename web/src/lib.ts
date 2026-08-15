// Core data layer: parsing, filtering, and shared pure utilities.
// winRateColor and teamName are canonical — imported by graph modules
// and Svelte components to avoid duplication.

import type {
  RawGraphData,
  ParsedGraph,
  Player,
  Link,
  Filters,
  ViewResult,
  RawTeamInfo,
} from "./types.ts";

// ---- JSON parsing ----

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
    };
    nodes.push(node);
    byId.set(id, node);
  }

  const links: Link[] = [];
  for (const e of data.edges ?? []) {
    const a = byId.get(normId(e.playerA));
    const b = byId.get(normId(e.playerB));
    if (!a || !b) continue;
    links.push({
      source: a,
      target: b,
      w: e.weight,
      recency: e.recency ?? 0.5,
      dates: (e.dates ?? []).slice().sort(),
    });
  }

  for (const l of links) {
    l.source.globalDeg++;
    l.target.globalDeg++;
  }
  const maxGlobalDeg = Math.max(1, ...nodes.map((n) => n.globalDeg));

  const teams: Record<number, RawTeamInfo> = {};
  for (const [k, v] of Object.entries(data.teams ?? {})) {
    teams[Number(k)] = v as RawTeamInfo;
  }

  const winRates = new Map<string, number>();
  for (const [k, v] of Object.entries(data.winRates ?? {})) {
    const [a, b] = k.split(",");
    winRates.set(`${normId(a)},${normId(b)}`, v as number);
  }

  const games = (data.games ?? []).map((g) => ({
    ...g,
    competitors: (g.competitors ?? []).map((c) => ({
      ...c,
      roster: (c.roster ?? []).map((e) => ({ ...e, playerId: normId(e.playerId) })),
    })),
  }));

  return {
    nodes,
    links,
    teams,
    maxGlobalDeg,
    dateMin: data.dateMin ?? null,
    dateMax: data.dateMax ?? null,
    winRates,
    games,
    playerTeamDates,
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
): CacheKey {
  const parts: string[] = [
    String(nodeCount),
    String(linkCount),
    String(filters.minW),
    String(filters.maxW),
    String(filters.minD),
    String(filters.maxD),
    filters.dateStart ?? "",
    filters.dateEnd ?? "",
  ];
  if (matchPlayers) {
    parts.push("mp:" + [...matchPlayers].sort((a, b) => a - b).join(","));
  }
  if (matchTeamOf) {
    parts.push("mt:" + [...matchTeamOf.entries()].sort((a, b) => a[0] - b[0]).map((e) => `${e[0]}=${e[1]}`).join(","));
  }
  return parts.join("|");
}

export function visibleSubset(
  nodes: Player[],
  links: Link[],
  minW: number,
  maxW: number,
  minD: number,
  maxD: number,
  dateStart: string | null,
  dateEnd: string | null,
  prevPos: Map<number, { x: number; y: number }>,
  playerTeamDates: Map<number, Map<number, string[]>>,
  matchPlayers: Set<number> | null = null,
  matchTeamOf: Map<number, number> | null = null,
): ViewResult {
  const filters: Filters = { minW, maxW, minD, maxD, dateStart, dateEnd };
  const key = makeKey(nodes.length, links.length, filters, matchPlayers, matchTeamOf);
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

  const nodeSet = matchPlayers ? nodes.filter((n) => matchPlayers.has(n.id)) : nodes;
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
    if (!inSet.has(l.source.id) || !inSet.has(l.target.id)) continue;
    const w = l.dates.length ? l.dates.filter(inRange).length : l.w;
    if (w === 0) continue;
    deg.set(l.source.id, (deg.get(l.source.id) || 0) + 1);
    deg.set(l.target.id, (deg.get(l.target.id) || 0) + 1);
    kept.push({ l, w });
  }

  const wLo = Math.min(minW, maxW);
  const wHi = Math.max(minW, maxW);
  const dLo = Math.min(minD, maxD);
  const dHi = Math.max(minD, maxD);

  const filtered = kept.filter(
    ({ l, w }) =>
      w >= wLo &&
      w <= wHi &&
      (deg.get(l.source.id) || 0) >= dLo &&
      (deg.get(l.source.id) || 0) <= dHi &&
      (deg.get(l.target.id) || 0) >= dLo &&
      (deg.get(l.target.id) || 0) <= dHi,
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
      const node: Player = {
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
