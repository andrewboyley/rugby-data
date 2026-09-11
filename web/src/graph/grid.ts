// Shared reference-grid overlay used by both the main graph view
// (GraphController) and the test page (GraphologyTestPage). Draws grid lines
// aligned to graph coordinates (so they pan/zoom with the camera) plus a
// coordinate label on each line.
//
// The overlay owns its own <canvas>, inserted as the first child of the host so
// it sits behind sigma's render canvas (the grid reads as a background layer).

import type Sigma from "sigma";

export interface GridOverlayOpts {
  getSigma: () => Sigma | null;
  getShow: () => boolean;
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

  // Sigma establishes its final viewport transform during rendering. Redraw after
  // that pass so the first grid uses the same coordinates as subsequent pans.
  const sigma = opts.getSigma();
  const onAfterRender = () => draw();
  sigma?.on("afterRender", onAfterRender);
  // The Home camera is fixed at the centre of Sigma's framed space. Keeping the
  // grid origin fixed there prevents camera updates from rebasing its labels.
  const origin = { x: 0.5, y: 0.5 };

  function draw(): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sigma = opts.getSigma();
    if (!opts.getShow() || !sigma) {
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

    // Use Sigma's framed camera coordinates rather than the graph's raw bounds.
    // An empty graph has no meaningful raw bounds, while the framed space has a
    // stable origin at the Home camera position.
    // Sigma refreshes its cached matrix on the next render frame. The overlay is
    // also drawn from camera events, so explicitly use the new camera state.
    const cameraState = sigma.getCamera().getState();
    const viewportToFramed = (point: { x: number; y: number }) => (
      sigma.viewportToFramedGraph(point, { cameraState })
    );
    const framedToViewport = (point: { x: number; y: number }) => (
      sigma.framedGraphToViewport(point, { cameraState })
    );
    const tl = viewportToFramed({ x: 0, y: 0 });
    const br = viewportToFramed({ x: cssW, y: cssH });
    const originScreen = framedToViewport(origin);
    const frameDelta = 0.01;
    const xPixelsPerFrame = Math.abs(
      framedToViewport({ x: origin.x + frameDelta, y: origin.y }).x - originScreen.x,
    ) / frameDelta;
    const yPixelsPerFrame = Math.abs(
      framedToViewport({ x: origin.x, y: origin.y + frameDelta }).y - originScreen.y,
    ) / frameDelta;
    const yReferenceScale = yPixelsPerFrame / xPixelsPerFrame;
    // At Home, the shortest viewport edge spans -100 to 100 reference units.
    // Calculate that scale from the fixed Home camera, not the current zoom.
    const homeCameraState = { x: 0.5, y: 0.5, ratio: 1, angle: 0 };
    const homeOriginScreen = sigma.framedGraphToViewport(origin, { cameraState: homeCameraState });
    const homeXPixelsPerFrame = Math.abs(
      sigma.framedGraphToViewport(
        { x: origin.x + frameDelta, y: origin.y },
        { cameraState: homeCameraState },
      ).x - homeOriginScreen.x,
    ) / frameDelta;
    const referenceUnits = 200 * homeXPixelsPerFrame / Math.min(cssW, cssH);
    const toReference = (value: number, axis: "x" | "y") => (
      value - origin[axis]
    ) * referenceUnits * (axis === "x" ? 1 : yReferenceScale);
    const toFramed = (value: number, axis: "x" | "y") => (
      value / (referenceUnits * (axis === "x" ? 1 : yReferenceScale)) + origin[axis]
    );
    const visMinX = Math.min(toReference(tl.x, "x"), toReference(br.x, "x"));
    const visMaxX = Math.max(toReference(tl.x, "x"), toReference(br.x, "x"));
    const visMinY = Math.min(toReference(tl.y, "y"), toReference(br.y, "y"));
    const visMaxY = Math.max(toReference(tl.y, "y"), toReference(br.y, "y"));

    // Grid step adapts to zoom: keep ~14 cells across the visible viewport. The
    // Y reference scale compensates for Sigma's non-square framed viewport.
    const step = niceStep(Math.max(visMaxX - visMinX, visMaxY - visMinY) / 14);

    const toX = (wx: number) => framedToViewport({ x: toFramed(wx, "x"), y: origin.y }).x;
    const toY = (wy: number) => framedToViewport({ x: origin.x, y: toFramed(wy, "y") }).y;
    // A graph can extend below a clipped page viewport. Keep x labels on the
    // visible bottom edge rather than drawing them outside the viewport.
    const visibleLabelY = Math.max(
      12,
      Math.min(cssH - 4, window.innerHeight - host.getBoundingClientRect().top - 4),
    );

    const screenStep = Math.abs(toX(step) - toX(0));
    const screenCellHeight = Math.abs(toY(step) - toY(0));
    canvas.dataset.gridOrigin = JSON.stringify(originScreen);
    canvas.dataset.gridCellSize = JSON.stringify({ width: screenStep, height: screenCellHeight });
    canvas.dataset.gridExtent = JSON.stringify({
      width: visMaxX - visMinX,
      height: visMaxY - visMinY,
    });

    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "alphabetic";

    for (let wx = Math.floor(visMinX / step) * step; wx <= visMaxX; wx += step) {
      const sx = toX(wx);
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, cssH); ctx.stroke();
      if (screenStep >= 36) {
        ctx.fillStyle = label;
        ctx.fillText(formatCoord(wx), sx + 3, visibleLabelY);
      }
    }
    for (let wy = Math.floor(visMinY / step) * step; wy <= visMaxY; wy += step) {
      const sy = toY(wy);
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(cssW, sy); ctx.stroke();
      if (screenStep >= 36) {
        ctx.fillStyle = label;
        ctx.fillText(formatCoord(wy), 3, sy - 3);
      }
    }

  }

  return {
    draw,
    destroy() {
      sigma?.off("afterRender", onAfterRender);
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
