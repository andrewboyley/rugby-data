// Sigma node/edge reducers. Pure functions over interaction state.

import type Graph from "graphology";
import {
  ACTIVE_BORDER_COLOR,
  DIMMED_NODE_COLOR,
  SHARED_MATCH_COLOR,
  applyAlpha,
  needsBorder,
} from "./colors.ts";

// State accessor pattern: reducers read live interaction state through
// getter functions so Svelte doesn't recreate them on every render.

export type StateGetters = {
  graph: () => Graph | null;
  focusId: () => string | null;
  focusNeighbors: () => Set<string>;
  hoveredId: () => string | null;
  hoveredOther: () => string | null;
  pinnedId: () => string | null;
  pinnedNeighbors: () => Set<string>;
  pinnedEdge: () => string | null;
  edgePartnerId: () => string | null;
  hoverTeamId: () => number | null;
  showEdges: () => boolean;
  alphaMin: () => number;
  alphaMax: () => number;
};

export function edgeBaseColor(graph: Graph, attrs: Record<string, unknown>): string | null {
  const mode = graph.getAttribute("edgeColorMode");
  if (mode === "winrate") return attrs.wr as string | null;
  return SHARED_MATCH_COLOR;
}

export function createNodeReducer(state: StateGetters) {
  return (node: string, data: Record<string, unknown>): Record<string, unknown> => {
    const res = { ...data };
    const focus = state.focusId();
    const isHovered = node === state.hoveredId() || node === state.hoveredOther();
    const isActive = state.pinnedId() != null && node === state.pinnedId();
    const partner = state.edgePartnerId();
    const isSecondaryActive = node === partner;
    const isNeighbor = state.focusNeighbors().has(node);

    res.isActive = isActive;
    res.isSecondary = isSecondaryActive;
    res.isHovered = isHovered;

    if (isActive || isSecondaryActive || isHovered) {
      res.forceLabel = true;
    } else {
      res.label = "";
    }

    res.type = "border";

    const hoverTeamId = state.hoverTeamId();
    if (hoverTeamId != null) {
      const nodeTeam = data.team as number | null | undefined;
      if (nodeTeam === hoverTeamId) {
        res.forceLabel = true;
      } else {
        res.label = "";
        res.color = DIMMED_NODE_COLOR;
        res.borderColor = "transparent";
      }
    }

    if (focus != null) {
      if (isActive) {
        res.type = "activeBorder";
      } else if (isSecondaryActive) {
        res.borderColor = ACTIVE_BORDER_COLOR;
      } else if (!isSecondaryActive && !isHovered && !isNeighbor) {
        res.label = "";
        res.color = DIMMED_NODE_COLOR;
        res.borderColor = "transparent";
      }
    }

    if (isActive) {
      res.borderColor = ACTIVE_BORDER_COLOR;
    } else if (res.borderColor === undefined) {
      res.borderColor = needsBorder(res.color as string);
    }
    return res;
  };
}

export function createEdgeReducer(state: StateGetters) {
  return (_edge: string, data: Record<string, unknown>): Record<string, unknown> => {
    const res = { ...data };
    const g = state.graph();
    if (!g) return res;

    const aMin = Math.min(
      Number(g.getAttribute("edgeAlphaMin") ?? state.alphaMin()),
      Number(g.getAttribute("edgeAlphaMax") ?? state.alphaMax()),
    );
    const aMax = Math.max(
      Number(g.getAttribute("edgeAlphaMin") ?? state.alphaMin()),
      Number(g.getAttribute("edgeAlphaMax") ?? state.alphaMax()),
    );
    if (aMin === 0 && aMax === 0) {
      res.hidden = true;
      return res;
    }

    const base = edgeBaseColor(g, data);
    if (base == null) {
      res.hidden = true;
      return res;
    }
    const alpha = aMin + (aMax - aMin) * Math.min(1, Math.max(0, (data.recency as number) ?? 0.5));
    res.color = applyAlpha(base, alpha);

    const pinned = state.pinnedId();
    if (pinned != null) {
      const [a, b] = g.extremities(_edge);
      const joinsPinned =
        (a === pinned && state.pinnedNeighbors().has(b)) ||
        (b === pinned && state.pinnedNeighbors().has(a));
      const hovered = state.hoveredOther();
      const joinsHoveredOther =
        hovered != null &&
        a !== b &&
        ((a === pinned && b === hovered) || (b === pinned && a === hovered));
      if (_edge === state.pinnedEdge()) {
        res.color = base;
      } else if (joinsHoveredOther) {
        res.color = base;
      } else if (!joinsPinned) {
        res.hidden = true;
      }
      return res;
    }

    const pinnedEdgeKey = state.pinnedEdge();
    if (pinnedEdgeKey != null) {
      if (_edge === pinnedEdgeKey) res.color = base;
      else res.hidden = true;
      return res;
    }

    const focus = state.focusId();
    if (focus == null) {
      if (!state.showEdges()) res.hidden = true;
      return res;
    }
    const [a, b] = g.extremities(_edge);
    const adjacent =
      (a === focus && state.focusNeighbors().has(b)) ||
      (b === focus && state.focusNeighbors().has(a));
    if (!adjacent) res.hidden = true;
    return res;
  };
}
