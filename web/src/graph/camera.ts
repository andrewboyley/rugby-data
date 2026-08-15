// Camera framing utilities.

import { getCameraStateToFitViewportToNodes } from "@sigma/utils";
import type { Sigma } from "sigma";
import type Graph from "graphology";

const RATIO_ITERATIONS = 4;

export function fitToNodes(
  sigma: Sigma | null,
  graph: Graph | null,
  nodeKeys: string[],
  opts: { animate?: boolean } = {},
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
  const widthLimiting = groupHeight / groupWidth < height / width;
  const limitDim = widthLimiting ? width : height;
  const radiusPx = (ratio: number) => maxSize / Math.sqrt(ratio);

  let ratio = state.ratio;
  for (let i = 0; i < RATIO_ITERATIONS; i++) {
    ratio = (state.ratio * limitDim) / (limitDim - 2 * radiusPx(ratio));
  }
  const final = { ...state, ratio };
  if (opts.animate) {
    sigma.getCamera().animate(final);
  } else {
    sigma.getCamera().setState(final);
  }
}

export function fitAll(sigma: Sigma | null, graph: Graph | null, opts: { animate?: boolean } = {}): void {
  if (!sigma || !graph || graph.order === 0) return;
  const nodeKeys: string[] = [];
  graph.forEachNode((id) => nodeKeys.push(id));
  fitToNodes(sigma, graph, nodeKeys, opts);
}

export function zoomToTeam(sigma: Sigma | null, graph: Graph | null, teamId: number | null): void {
  if (!sigma || !graph || teamId == null) return;
  const nodeKeys: string[] = [];
  graph.forEachNode((id, attrs) => {
    if (attrs.team === teamId) nodeKeys.push(id);
  });
  fitToNodes(sigma, graph, nodeKeys);
}
