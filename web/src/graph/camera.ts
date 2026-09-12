// Camera framing utilities.

import { getCameraStateToFitViewportToNodes } from "@sigma/utils";
import type { Sigma } from "sigma";
import type Graph from "graphology";

const RATIO_ITERATIONS = 4;

export function fitToNodes(
  sigma: Sigma | null,
  graph: Graph | null,
  nodeKeys: string[],
  opts: { animate?: boolean } = { animate: true },
): void {
  if (!sigma || !graph || nodeKeys.length === 0) return;
  const state = getCameraStateToFitViewportToNodes(sigma, nodeKeys);
  const { width, height } = sigma.getDimensions();

  let groupMinX = Infinity;
  let groupMaxX = -Infinity;
  let groupMinY = Infinity;
  let groupMaxY = -Infinity;
  let maxSize = 0;
  for (const id of nodeKeys) {
    const attrs = graph.getNodeAttributes(id);
    groupMinX = Math.min(groupMinX, attrs.x);
    groupMaxX = Math.max(groupMaxX, attrs.x);
    groupMinY = Math.min(groupMinY, attrs.y);
    groupMaxY = Math.max(groupMaxY, attrs.y);
    maxSize = Math.max(maxSize, attrs.size || 0);
  }
  const groupWidth = groupMaxX - groupMinX || 1;
  const groupHeight = groupMaxY - groupMinY || 1;
  if (nodeKeys.length === 1) {
    // A point has no bounding box for Sigma's generic fitter to scale. Frame it
    // at a readable 10px radius while respecting the camera's minimum ratio.
    const ratio = Math.max(0.01, Math.min(10, (maxSize / 10) ** 2));
    const final = { ...state, ratio };
    if (opts.animate) sigma.getCamera().animate(final);
    else sigma.getCamera().setState(final);
    return;
  }
  const widthLimiting = groupHeight / groupWidth < height / width;
  const limitDim = widthLimiting ? width : height;
  const radiusPx = (ratio: number) => maxSize / Math.sqrt(ratio);

  let ratio = state.ratio;
  for (let i = 0; i < RATIO_ITERATIONS; i++) {
    ratio = (state.ratio * limitDim) / (limitDim - 2 * radiusPx(ratio));
  }
  const final: { x: number; y: number; ratio: number; angle?: number } = {
    ...state,
    ratio,
  };
  if (opts.animate) {
    sigma.getCamera().animate(final);
  } else {
    sigma.getCamera().setState(final);
  }
}

export function fitAll(
  sigma: Sigma | null,
  graph: Graph | null,
  opts: { animate?: boolean } = {},
): void {
  if (!sigma || !graph || graph.order === 0) return;
  const nodeKeys: string[] = [];
  graph.forEachNode((id) => nodeKeys.push(id));
  fitToNodes(sigma, graph, nodeKeys, opts);
}

export function zoomToTeam(
  sigma: Sigma | null,
  graph: Graph | null,
  teamId: number | null,
): void {
  if (!sigma || !graph || teamId == null) return;
  const nodeKeys: string[] = [];
  graph.forEachNode((id, attrs) => {
    if (attrs.team === teamId) nodeKeys.push(id);
  });
  fitToNodes(sigma, graph, nodeKeys);
}

/**
 * Remap all node positions into the unit square [0, 1] using a uniform scale
 * that preserves the graph's aspect ratio. Sigma's display normalization keeps
 * node rendering in [0, 1], but the stored coordinates (produced by the FA2
 * layout at thousands of units) must also be normalized so that camera framing
 * (`getBBox`/`fitToNodes`) and node sizing operate on a unit-extent graph.
 */
export function normalizePositions(graph: Graph): void {
  if (graph.order === 0) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  graph.forEachNode((_id, attr) => {
    if (!Number.isFinite(attr.x) || !Number.isFinite(attr.y)) return;
    if (attr.x < minX) minX = attr.x;
    if (attr.y < minY) minY = attr.y;
    if (attr.x > maxX) maxX = attr.x;
    if (attr.y > maxY) maxY = attr.y;
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;

  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const span = Math.max(spanX, spanY);

  graph.forEachNode((id, attr) => {
    if (!Number.isFinite(attr.x) || !Number.isFinite(attr.y)) return;
    graph.setNodeAttribute(id, "x", (attr.x - minX) / span);
    graph.setNodeAttribute(id, "y", (attr.y - minY) / span);
  });
}
