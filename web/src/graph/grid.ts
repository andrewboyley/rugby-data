// Shared reference-grid overlay used by both the main graph view
// (GraphController) and the test page (GraphologyTestPage). Draws grid lines
// aligned to graph coordinates (so they pan/zoom with the camera) plus a
// coordinate label on each line, and an optional clamp/bounds box.
//
// The overlay owns its own <canvas>, inserted as the first child of the host so
// it sits behind sigma's render canvas (the grid reads as a background layer).

import type Sigma from "sigma";
import type Graph from "graphology";

export interface GridBounds {
  maxX: number;
  maxY: number;
}

export interface GridOverlayOpts {
  getSigma: () => Sigma | null;
  getGraph: () => Graph | null;
  getShow: () => boolean;
  /** Optional clamp/bounds box to outline (e.g. test page's enforceBounds). */
  getBounds?: () => GridBounds | null;
}

export interface GridOverlay {
  draw(): void;
  destroy(): void;
}

export function createGridOverlay(host: HTMLElement, opts: GridOverlayOpts): GridOverlay {
  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.pointerEvents = "none";
  host.insertBefore(canvas, host.firstChild);

  function draw(): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sigma = opts.getSigma();
    const graph = opts.getGraph();
    if (!opts.getShow() || !sigma || !graph || graph.order === 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const cssW = host.clientWidth;
    const cssH = host.clientHeight;
    const pxW = Math.round(cssW * dpr);
    const pxH = Math.round(cssH * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const stroke = gridStrokeColor(host);
    const label = gridStrokeColor(host, 0.6);

    // Visible world bounds so the grid fills the viewport even when panned
    // away from the graph.
    const tl = sigma.viewportToGraph({ x: 0, y: 0 });
    const br = sigma.viewportToGraph({ x: cssW, y: cssH });
    const visMinX = Math.min(tl.x, br.x);
    const visMaxX = Math.max(tl.x, br.x);
    const visMinY = Math.min(tl.y, br.y);
    const visMaxY = Math.max(tl.y, br.y);

    // Grid step adapts to zoom: keep ~14 cells across the visible viewport, so
    // zooming out yields fewer, larger cells (and zooming in finer ones).
    const stepX = niceStep((visMaxX - visMinX) / 14);
    const stepY = niceStep((visMaxY - visMinY) / 14);

    const toX = (wx: number) => sigma.graphToViewport({ x: wx, y: 0 }).x;
    const toY = (wy: number) => sigma.graphToViewport({ x: 0, y: wy }).y;

    const screenStepX = Math.abs(toX(stepX) - toX(0));
    const screenStepY = Math.abs(toY(stepY) - toY(0));

    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "alphabetic";

    for (let wx = Math.floor(visMinX / stepX) * stepX; wx <= visMaxX; wx += stepX) {
      const sx = toX(wx);
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, cssH); ctx.stroke();
      if (screenStepX >= 36) {
        ctx.fillStyle = label;
        ctx.fillText(formatCoord(wx), sx + 3, cssH - 4);
      }
    }
    for (let wy = Math.floor(visMinY / stepY) * stepY; wy <= visMaxY; wy += stepY) {
      const sy = toY(wy);
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(cssW, sy); ctx.stroke();
      if (screenStepY >= 36) {
        ctx.fillStyle = label;
        ctx.fillText(formatCoord(wy), 3, sy - 3);
      }
    }

    const bounds = opts.getBounds?.();
    if (bounds) {
      // Bounds box is centered on the origin (0, 0).
      const p1 = sigma.graphToViewport({ x: -bounds.maxX, y: -bounds.maxY });
      const p2 = sigma.graphToViewport({ x: bounds.maxX, y: bounds.maxY });
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = "rgba(255,0,0,0.4)";
      ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      ctx.setLineDash([]);
    }
  }

  return {
    draw,
    destroy() {
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
}

/** Round a span up to a visually pleasant 1/2/5 × 10^k step. */
function niceStep(raw: number): number {
  if (!isFinite(raw) || raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const f = raw / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * base;
}

/** Theme-aware colour: reuse the host's resolved text colour so the grid
 *  contrasts on both dark and light themes. */
function gridStrokeColor(host: HTMLElement, alpha = 0.15): string {
  const color = getComputedStyle(host).color;
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return `rgba(255, 255, 255, ${alpha})`;
}

/** Compact coordinate label: trims trailing zeros. */
function formatCoord(v: number): string {
  return parseFloat(v.toFixed(2)).toString();
}
