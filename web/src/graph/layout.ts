// ForceAtlas2 layout management with automatic settlement detection.

import forceAtlas2 from "graphology-layout-forceatlas2";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import { circular } from "graphology-layout";
import type Graph from "graphology";

const POSITION_SAVE_INTERVAL_MS = 60_000;
const SETTLED_TICK_MS = 50;
const SETTLE_EPSILON = 0.5;
const SETTLE_TICKS = 10;

const LAYOUT_SETTINGS = {
  gravity: 0.5,
  slowDown: 50,
};

// graphology-layout types LayoutMapping as {[node: string]: {[dimension: string]: number}}
// We use a more specific local alias for the position store.
type LayoutPositions = Record<string, { x: number; y: number }>;

export function circularSeed(graph: Graph): LayoutPositions {
  const raw = circular(graph, { scale: 100 });
  const out: LayoutPositions = {};
  for (const key in raw) {
    const val = (raw as Record<string, { x: number; y: number }>)[key];
    out[key] = { x: val.x, y: val.y };
  }
  return out;
}

export interface LayoutManagerCallbacks {
  onNodeMove: () => void;
  onSettled: () => void;
}

export function createLayoutManager(graph: Graph, callbacks: LayoutManagerCallbacks) {
  let layout: FA2Layout | null = null;
  let saveTimer: ReturnType<typeof setInterval> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  function start(): void {
    if (layout) layout.kill();
    const current = new FA2Layout(graph, {
      settings: { ...forceAtlas2.inferSettings(graph), ...LAYOUT_SETTINGS },
    });
    layout = current;
    current.start();
    stopTimers();
    saveTimer = setInterval(callbacks.onNodeMove, POSITION_SAVE_INTERVAL_MS);
    pollSettlement(current);
  }

  function pollSettlement(current: FA2Layout): void {
    let lastPos: Map<number, { x: number; y: number }> | null = null;
    let still = 0;
    const tick = () => {
      if (layout !== current || !current.isRunning()) return;
      let moved = 0;
      if (lastPos) {
        graph.forEachNode((id, attrs) => {
          const prev = lastPos!.get(Number(id));
          if (prev) moved = Math.max(moved, Math.hypot(attrs.x - prev.x, attrs.y - prev.y));
        });
      }
      lastPos = new Map();
      graph.forEachNode((id, attrs) => {
        const pos = { x: attrs.x, y: attrs.y };
        lastPos!.set(Number(id), pos);
      });

      if (moved >= SETTLE_EPSILON) {
        still = 0;
      } else {
        still++;
      }

      if (still >= SETTLE_TICKS) {
        stopTimers();
        if (layout === current && current.isRunning()) current.stop();
        callbacks.onSettled();
        return;
      }
      settleTimer = setTimeout(tick, SETTLED_TICK_MS);
    };
    tick();
  }

  function stopTimers(): void {
    if (saveTimer) {
      clearInterval(saveTimer);
      saveTimer = null;
    }
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
  }

  function dispose(): void {
    stopTimers();
    if (layout) {
      layout.kill();
      layout = null;
    }
  }

  return { start, dispose };
}
