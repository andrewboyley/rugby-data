// Web Worker for offloading parseGraph off the main thread.
// Receives raw JSON text, returns serializable ParsedGraphData.

import type {
  RawGraphData,
  Player,
  Coach,
  GraphNode,
  RawTeamInfo,
  ParsedGraphData,
  SerializableLink,
} from "./types.ts";

function normIdFactory() {
  const idMap = new Map<string, number>();
  let autoId = 1_000_000;
  return (raw: unknown): number => {
    const key = String(raw);
    const existing = idMap.get(key);
    if (existing !== undefined) return existing;
    const id = /^\d+$/.test(key) ? Number(key) : autoId++;
    idMap.set(key, id);
    return id;
  };
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

function parseGraphInWorker(text: string): ParsedGraphData {
  const data: RawGraphData = JSON.parse(text);
  const normId = normIdFactory();

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
  const playerTeamDates: Record<number, Record<number, string[]>> = {};
  for (const [k, v] of Object.entries(data.playerTeamDates ?? {})) {
    const inner: Record<number, string[]> = {};
    for (const [tk, tv] of Object.entries(v as Record<string, string[]>)) {
      inner[Number(tk)] = (tv as string[]).slice().sort();
    }
    playerTeamDates[normId(k)] = inner;
  }
  const playerJersey: Record<number, number> = {};
  for (const [k, v] of Object.entries(data.playerJersey ?? {})) {
    playerJersey[normId(k)] = Number(v);
  }
  const playerDates: Record<number, string[]> = {};
  for (const [k, v] of Object.entries(data.playerDates ?? {})) {
    playerDates[normId(k)] = (v as string[]).slice().sort();
  }

  const coachDates: Record<string, string[]> = data.coachDates ?? {};
  const coachTeams: Record<string, number[]> = data.coachTeams ?? {};
  const coachNames: Record<string, string> = data.coaches ?? {};
  const coachAppearances: Record<string, number> = data.coachAppearances ?? {};

  const coachNodes: Coach[] = [];
  const coachById = new Map<number, GraphNode>();
  const coachOrigToNorm = new Map<string, number>();
  const mergedCoachIds = new Map<number, number>();

  for (const [cid, app] of Object.entries(coachAppearances)) {
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

  const coachTeamDates: Record<number, Record<number, string[]>> = {};
  for (const [k, v] of Object.entries(data.coachTeamDates ?? {})) {
    const normKid = coachOrigToNorm.get(k);
    if (normKid != null) {
      const inner: Record<number, string[]> = {};
      for (const [tk, tv] of Object.entries(v as Record<string, string[]>)) {
        inner[Number(tk)] = (tv as string[]).slice().sort();
      }
      coachTeamDates[normKid] = inner;
    }
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

  for (const [normCid, twin] of mergedCoachIds) {
    const twinNode = byId.get(twin);
    if (twinNode) coachById.set(normCid, twinNode);
  }

  const links: SerializableLink[] = [];
  const person = (id: number) => (mergedCoachIds.get(id) ?? id);

  const coachPairs = new Set<string>();
  for (const e of data.coachEdges ?? []) {
    coachPairs.add(edgeKey(person(normId(e.coachA)), person(normId(e.coachB))));
  }

  for (const e of data.edges ?? []) {
    const a = byId.get(normId(e.playerA));
    const b = byId.get(normId(e.playerB));
    if (!a || !b) continue;
    const pa = person(a.id), pb = person(b.id);
    if (pa === pb) continue;
    if (coachPairs.has(edgeKey(pa, pb))) continue;
    const w = e.weight ?? 1;
    a.deg += w;
    b.deg += w;
    a.globalDeg += w;
    b.globalDeg += w;
    links.push({ source: a.id, target: b.id, w, recency: 0, dates: e.dates ?? [] });
  }

  for (const e of data.coachEdges ?? []) {
    const a = coachById.get(normId(e.coachA));
    const b = coachById.get(normId(e.coachB));
    if (!a || !b) continue;
    const w = e.weight ?? 1;
    if (!a.isCoach) a.deg += w;
    if (!b.isCoach) b.deg += w;
    a.globalDeg += w;
    b.globalDeg += w;
    links.push({ source: a.id, target: b.id, w, recency: 0, dates: e.dates ?? [], coach: true });
  }

  const teams: Record<number, RawTeamInfo> = {};
  for (const [k, v] of Object.entries(data.teams ?? {})) {
    const info = v as RawTeamInfo;
    teams[Number(k)] = {
      name: info.name,
      color: info.color ?? "",
      alternateColor: info.alternateColor ?? "",
      abbreviation: info.abbreviation ?? "",
    };
  }

  // Compute win rates per player
  const winRates: Record<number, number> = {};
  for (const n of nodes) {
    const gids = n.dates.map(d => d.slice(0, 10));
    let wins = 0, total = 0;
    for (const g of data.games ?? []) {
      if (!gids.includes(g.date?.slice(0, 10) ?? "")) continue;
      const me = g.competitors?.find(c => c.teamId === n.team);
      const opp = g.competitors?.find(c => c.teamId !== n.team);
      if (me && opp && typeof me.score === "number" && typeof opp.score === "number") {
        total++;
        if (me.score > opp.score) wins++;
      }
    }
    winRates[n.id] = total > 0 ? wins / total : 0.5;
  }

  let maxGlobalDeg = 1;
  for (const n of [...nodes, ...coachNodes]) {
    if (n.globalDeg > maxGlobalDeg) maxGlobalDeg = n.globalDeg;
  }

  const dateMin = data.dateMin ?? null;
  const dateMax = data.dateMax ?? null;

  return {
    nodes,
    coachNodes,
    links,
    teams,
    games: data.games ?? [],
    playerTeamDates,
    playerJersey,
    playerDates,
    appearances,
    playerTeams,
    coachDates,
    coachTeams,
    coachNames,
    coachAppearances,
    coachTeamDates,
    winRates,
    maxGlobalDeg,
    dateMin,
    dateMax,
  };
}

// Worker message handler
self.onmessage = (e: MessageEvent<{ text: string; id: number }>) => {
  const { text, id } = e.data;
  try {
    const result = parseGraphInWorker(text);
    self.postMessage({ id, result, error: null });
  } catch (err) {
    self.postMessage({ id, result: null, error: err instanceof Error ? err.message : String(err) });
  }
};

export {};