// Spin-ring overlay canvas: draws a rotating dashed ring around the
// currently-pinned (primary) node so the active selection reads clearly.

import { ACTIVE_BORDER_COLOR } from "./colors.ts";
import type { StateGetters } from "./reducers.ts";
import type { Sigma } from "sigma";
import type Graph from "graphology";

const RING_FRACTION = 1.35;
const DASH_FRACTION = 0.7;
const SPEED = 0.9;

export interface SpinRingOverlay {
  start(): void;
  stop(): void;
}

export function createSpinRing(
  host: HTMLElement,
  layer: HTMLCanvasElement,
  opts: {
    getSigma: () => Sigma | null;
    getGraph: () => Graph | null;
    state: StateGetters;
  },
): SpinRingOverlay {
  layer.style.pointerEvents = "none";

  let raf: number | null = null;
  let startTs = 0;

  function clear(): void {
    const ctx = layer.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = host.clientWidth;
    const height = host.clientHeight;
    layer.style.width = width + "px";
    layer.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
  }

  function draw(elapsed: number): void {
    const sigma = opts.getSigma();
    const graph = opts.getGraph();
    const ctx = layer.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = host.clientWidth;
    const height = host.clientHeight;
    const pw = Math.round(width * dpr);
    const ph = Math.round(height * dpr);
    if (layer.width !== pw || layer.height !== ph) {
      layer.width = pw;
      layer.height = ph;
      layer.style.width = width + "px";
      layer.style.height = height + "px";
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const id = opts.state.pinnedId();
    if (!sigma || !graph || !id || !graph.hasNode(id)) return;

    const point = sigma.graphToViewport({
      x: graph.getNodeAttribute(id, "x") as number,
      y: graph.getNodeAttribute(id, "y") as number,
    });
    const radius = sigma.scaleSize(graph.getNodeAttribute(id, "size") as number) * RING_FRACTION;
    const angle = (elapsed * SPEED) % (Math.PI * 2);

    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.setLineDash([radius * DASH_FRACTION, radius * DASH_FRACTION]);
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = ACTIVE_BORDER_COLOR;
    ctx.lineWidth = Math.max(1.5, radius * 0.12);
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.restore();
  }

  function frame(ts: number): void {
    if (startTs === 0) startTs = ts;
    draw((ts - startTs) / 1000);
    // Stop the loop once there is no active node to avoid idle redraws.
    if (opts.state.pinnedId() == null) {
      clear();
      raf = null;
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  return {
    start(): void {
      if (raf != null) return;
      startTs = 0;
      raf = requestAnimationFrame(frame);
    },
    stop(): void {
      if (raf != null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      clear();
    },
  };
}
