// Active-edge overlay canvas: re-strokes the highlighted edge and its
// endpoints above the node layer so they read as front-most.

import { ACTIVE_BORDER_COLOR } from "./colors.ts";
import { edgeBaseColor } from "./reducers.ts";
import type { StateGetters } from "./reducers.ts";
import type { Sigma } from "sigma";
import type Graph from "graphology";

const DISC_FRACTION = 0.8;
const RING_FRACTION = 0.9;
const MIN_RING_WIDTH = 1;

export interface ActiveEdgeOverlay {
  draw(): void;
}

export function createActiveEdgeOverlay(
  host: HTMLElement,
  layer: HTMLCanvasElement,
  opts: {
    getSigma: () => Sigma | null;
    getGraph: () => Graph | null;
    state: StateGetters;
  },
): ActiveEdgeOverlay {
  layer.style.pointerEvents = "none";

  function draw(): void {
    const sigma = opts.getSigma();
    const graph = opts.getGraph();
    if (!layer || !sigma || !graph || !host) return;
    const ctx = layer.getContext("2d");
    if (!ctx) return;

    let key = opts.state.pinnedEdge();
    if (opts.state.pinnedId() != null && opts.state.hoveredOther() != null) {
      const hoverEdge = graph.edge(opts.state.pinnedId(), opts.state.hoveredOther());
      if (hoverEdge != null) key = hoverEdge;
    }

    const width = host.clientWidth;
    const height = host.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (layer.width !== pixelWidth || layer.height !== pixelHeight) {
      layer.width = pixelWidth;
      layer.height = pixelHeight;
      layer.style.width = width + "px";
      layer.style.height = height + "px";
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (key == null || !graph.hasEdge(key)) return;
    const attrs = graph.getEdgeAttributes(key);
    const color = edgeBaseColor(graph, attrs);
    if (color == null) return;

    const [a, b] = graph.extremities(key);
    const src = sigma.graphToViewport({ x: graph.getNodeAttribute(a, "x"), y: graph.getNodeAttribute(a, "y") });
    const dst = sigma.graphToViewport({ x: graph.getNodeAttribute(b, "x"), y: graph.getNodeAttribute(b, "y") });
    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(dst.x, dst.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = sigma.scaleSize(attrs.size as number);
    ctx.lineCap = "round";
    ctx.stroke();

    const borderFor = (nodeId: string) =>
      nodeId === opts.state.pinnedId() || nodeId === opts.state.edgePartnerId()
        ? ACTIVE_BORDER_COLOR
        : graph.getNodeAttribute(nodeId, "borderColor");
    drawOverlayNode(ctx, sigma, graph, src, a, borderFor(a));
    drawOverlayNode(ctx, sigma, graph, dst, b, borderFor(b));
  }

  return { draw };
}

function drawOverlayNode(
  ctx: CanvasRenderingContext2D,
  sigma: Sigma,
  graph: Graph,
  point: { x: number; y: number },
  nodeId: string,
  borderColor: string | undefined,
): void {
  const radius = sigma.scaleSize(graph.getNodeAttribute(nodeId, "size") as number);
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius * DISC_FRACTION, 0, Math.PI * 2);
  ctx.fillStyle = graph.getNodeAttribute(nodeId, "color") as string;
  ctx.fill();
  if (borderColor && borderColor !== "transparent") {
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * RING_FRACTION, 0, Math.PI * 2);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = Math.max(MIN_RING_WIDTH, 0.2 * radius);
    ctx.stroke();
  }
}
