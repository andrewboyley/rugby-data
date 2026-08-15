// Layout-position persistence via localStorage.

const POSITIONS_KEY = "rugby-graph-positions";

export interface PositionStore {
  positions: Map<number, { x: number; y: number }>;
  load(): void;
  save(): void;
  capture(graph: Graph): void;
  persist(graph: Graph): void;
  replaceSeed(seed: Map<string, { x: number; y: number }>): void;
}

import type Graph from "graphology";

export function createPositionStore(initial = new Map<number, { x: number; y: number }>()): PositionStore {
  const positions = initial;

  function load(): void {
    try {
      const raw = localStorage.getItem(POSITIONS_KEY);
      if (!raw) return;
      const obj: Record<string, { x: number; y: number }> = JSON.parse(raw);
      for (const key in obj) positions.set(Number(key), obj[key]);
    } catch {
      // ignore corrupt/unavailable storage
    }
  }

  function save(): void {
    try {
      const obj: Record<string, { x: number; y: number }> = {};
      for (const [id, pos] of positions) obj[id] = { x: pos.x, y: pos.y };
      localStorage.setItem(POSITIONS_KEY, JSON.stringify(obj));
    } catch {
      // ignore quota/unavailable storage
    }
  }

  function capture(graph: Graph): void {
    if (!graph) return;
    graph.forEachNode((id, attrs) => {
      positions.set(Number(id), { x: attrs.x, y: attrs.y });
    });
  }

  function persist(graph: Graph): void {
    capture(graph);
    save();
  }

  function replaceSeed(seedPositions: Map<string, { x: number; y: number }>): void {
    positions.clear();
    for (const [key, value] of seedPositions) {
      positions.set(Number(key), value);
    }
  }

  return { positions, load, save, capture, persist, replaceSeed };
}
