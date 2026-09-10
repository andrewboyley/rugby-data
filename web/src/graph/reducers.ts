// Sigma v4 node/edge reducers. Pure functions over interaction state.

import type Graph from "graphology";
import type { Attributes } from "graphology-types";
import type { NodeDisplayData, EdgeDisplayData } from "sigma/types";
import type { TemporalIndex } from "../temporal/TemporalIndex";
import {
  ACTIVE_BORDER_COLOR,
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
  hoveredIds: () => Set<string>;
  hoveredOther: () => string | null;
  pinnedId: () => string | null;
  pinnedNeighbors: () => Set<string>;
  pinnedEdge: () => string | null;
  edgePartnerId: () => string | null;
  hoverTeamId: () => number | null;
  hoverMatchNodeIds: () => Set<string> | null;
  showEdges: () => boolean;
  alphaMin: () => number;
  alphaMax: () => number;
};

export function edgeBaseColor(graph: Graph, attrs: Attributes): string | null {
  const mode = graph.getAttribute("edgeColorMode");
  if (mode === "winrate") return attrs.wr as string | null;
  return SHARED_MATCH_COLOR;
}

export function createNodeReducer(state: StateGetters) {
  return (
    node: string,
    data: NodeDisplayData,
    attrs: Attributes,
  ): Partial<NodeDisplayData> => {
    const res = { ...data } as Record<string, unknown>;
    const hoveredIds = state.hoveredIds();
    const focus = state.focusId();
    const hoveredOther = state.hoveredOther();
    const isHovered = hoveredIds.has(node) || node === state.hoveredId() || node === hoveredOther;
    const isActive = state.pinnedId() != null && node === state.pinnedId();
    const isNeighbor = state.focusNeighbors().has(node);

    res.isActive = isActive;
    res.isSecondary = false;
    res.isHovered = isHovered;
    res.highlighted = isActive || isHovered;

    if (isActive || isHovered) {
      res.forceLabel = true;
    } else {
      res.label = "";
    }

    const hoverTeamId = state.hoverTeamId();
    const teamMatch = hoverTeamId != null && attrs.team === hoverTeamId;
    const jerseyMatch = hoveredIds.has(node);
    if (teamMatch || jerseyMatch) {
      res.forceLabel = true;
    } else if ((hoverTeamId != null || hoveredIds.size > 0) && !isHovered) {
      // Only dim non-hovered nodes
      res.label = "";
      const originalColor = (res.color as string) || (attrs.color as string);
      res.color = applyAlpha(originalColor, 0.15);
      res.borderColor = "transparent";
    }

    const hoverMatchIds = state.hoverMatchNodeIds();
    const inMatch = hoverMatchIds != null && hoverMatchIds.size > 0 && hoverMatchIds.has(node);
    const hasMatchHover = hoverMatchIds != null && hoverMatchIds.size > 0;

    if (hasMatchHover) {
      // Match hover active: only match nodes + pinned node are fully visible
      if (!inMatch && !isActive) {
        res.label = "";
        const originalColor = (res.color as string) || (attrs.color as string);
        res.color = applyAlpha(originalColor, 0.15);
        res.borderColor = "transparent";
      } else {
        res.forceLabel = true;
      }
    } else if (focus != null) {
      // Pinned node active, no match hover
      if (isActive) {
        // type = "activeBorder" not needed in v4
      } else if (isHovered && isNeighbor) {
        // Hovered neighbor - keep visible
      } else if (isNeighbor && !isHovered) {
        // Other neighbors get dimmed when a neighbor is hovered
        if (hoveredOther != null) {
          res.label = "";
          const originalColor = (res.color as string) || (attrs.color as string);
          res.color = applyAlpha(originalColor, 0.15);
          res.borderColor = "transparent";
        }
      } else if (!isNeighbor && !isHovered) {
        // Don't dim the hovered node even if not a neighbor
        res.label = "";
        const originalColor = (res.color as string) || (attrs.color as string);
        res.color = applyAlpha(originalColor, 0.15);
        res.borderColor = "transparent";
      }
    }

    if (isActive) {
      res.borderColor = ACTIVE_BORDER_COLOR;
    } else if (res.borderColor === undefined) {
      res.borderColor = needsBorder(res.color as string);
    }
    return res as Partial<NodeDisplayData>;
  };
}

export function createEdgeReducer(state: StateGetters) {
  return (
    _edge: string,
    data: EdgeDisplayData,
    attrs: Attributes,
  ): Partial<EdgeDisplayData> => {
    const res = { ...data } as Record<string, unknown>;
    const g = state.graph();
    if (!g) return res as Partial<EdgeDisplayData>;

    const aMin = Math.min(
      Number(g.getAttribute("edgeAlphaMin") ?? state.alphaMin()),
      Number(g.getAttribute("edgeAlphaMax") ?? state.alphaMax()),
    );
    const aMax = Math.max(
      Number(g.getAttribute("edgeAlphaMin") ?? state.alphaMin()),
      Number(g.getAttribute("edgeAlphaMax") ?? state.alphaMax()),
    );
    if (aMin === 0 && aMax === 0) {
      res.visibility = "hidden";
      return res as Partial<EdgeDisplayData>;
    }

    // Coach edges get the neutral shared-match color when they have no
    // winrate entry, instead of being hidden like winrate-less player edges.
    const [ca, cb] = g.extremities(_edge);
    const isCoachEdge = Boolean(
      g.getNodeAttribute(ca, "isCoach") || g.getNodeAttribute(cb, "isCoach"),
    );
    const base = edgeBaseColor(g, attrs) ?? (isCoachEdge ? SHARED_MATCH_COLOR : null);
    if (base == null) {
      res.visibility = "hidden";
      return res as Partial<EdgeDisplayData>;
    }
    const alpha = aMin + (aMax - aMin) * Math.min(1, Math.max(0, (attrs.recency as number) ?? 0.5));
    res.color = applyAlpha(base, alpha);

    if (!state.showEdges()) {
      res.visibility = "hidden";
      return res as Partial<EdgeDisplayData>;
    }

    const pinned = state.pinnedId();
    const hoverMatchIds = state.hoverMatchNodeIds();
    const hasMatchHover = hoverMatchIds != null && hoverMatchIds.size > 0;
    const hoveredOther = state.hoveredOther();

    if (pinned != null) {
      const [a, b] = g.extremities(_edge);
      const pinnedNeighbors = state.pinnedNeighbors();
      const hasHoveredNeighbor = hoveredOther != null && pinnedNeighbors.has(hoveredOther);
      const aIsPinned = a === pinned;
      const bIsPinned = b === pinned;
      const aIsHoveredNeighbor = a === hoveredOther;
      const bIsHoveredNeighbor = b === hoveredOther;
      const aIsPinnedNeighbor = pinnedNeighbors.has(a);
      const bIsPinnedNeighbor = pinnedNeighbors.has(b);
      const joinsPinned =
        (aIsPinned && bIsPinnedNeighbor) ||
        (bIsPinned && aIsPinnedNeighbor);
      const joinsHoveredNeighbor =
        (aIsPinned && bIsHoveredNeighbor) ||
        (bIsPinned && aIsHoveredNeighbor);
      const hovered = state.hoveredOther();
      const joinsHoveredOther =
        hovered != null &&
        a !== b &&
        ((a === pinned && b === hovered) || (b === pinned && a === hovered));

      if (hasMatchHover) {
        const aInMatch = hoverMatchIds!.has(a);
        const bInMatch = hoverMatchIds!.has(b);

        // Show edge if it connects pinned node to a match node that is its neighbor
        if ((aIsPinned && bInMatch && bIsPinnedNeighbor) ||
            (bIsPinned && aInMatch && aIsPinnedNeighbor)) {
          res.color = base;
          return res as Partial<EdgeDisplayData>;
        }

        // Hide edges to neighbors not in match
        if (joinsPinned) {
          res.visibility = "hidden";
          return res as Partial<EdgeDisplayData>;
        }
      }

      if (_edge === state.pinnedEdge() || joinsHoveredOther) {
        res.color = base;
      } else if (hasHoveredNeighbor && joinsHoveredNeighbor) {
        // Show edge between pinned and the specific hovered neighbor
        res.color = base;
      } else if (!hasHoveredNeighbor && joinsPinned) {
        // No neighbor hovered - show all pinned neighbor edges
        if (hoveredOther != null && !pinnedNeighbors.has(hoveredOther)) {
          // Hovering an unconnected node - dim pinned's edges
          res.color = applyAlpha(base, 0.15);
        } else {
          res.color = base;
        }
      } else if (joinsPinned) {
        // Other pinned neighbor edges - dim them
        res.color = applyAlpha(base, 0.15);
      } else {
        res.visibility = "hidden";
      }
      return res as Partial<EdgeDisplayData>;
    }

    const pinnedEdgeKey = state.pinnedEdge();
    if (pinnedEdgeKey != null) {
      if (_edge === pinnedEdgeKey) res.color = base;
      else res.visibility = "hidden";
      return res as Partial<EdgeDisplayData>;
    }

    const focus = state.focusId();
    if (focus == null) {
      if (!state.showEdges()) res.visibility = "hidden";
      return res as Partial<EdgeDisplayData>;
    }
    const [a, b] = g.extremities(_edge);
    const adjacent =
      (a === focus && state.focusNeighbors().has(b)) ||
      (b === focus && state.focusNeighbors().has(a));
    if (!adjacent) res.visibility = "hidden";
    return res as Partial<EdgeDisplayData>;
  };
}

export type TemporalReducerState = {
  graph: () => Graph | null;
  temporalIndex: () => TemporalIndex | null;
  time: () => number;
  teamId: () => number | null;
  minMatchCount: () => number;
  edgeColorMode: () => "shared" | "winRate" | "recency";
  selectedId: () => string | null;
  partnerId: () => string | null;
  matchPlayerIds: () => Set<string> | null;
};

/** Shared temporal equivalents of the legacy match and partner overlays. */
export function createTemporalNodeReducer(state: TemporalReducerState) {
  return (node: string, data: NodeDisplayData, attrs: Attributes): Partial<NodeDisplayData> => {
    const temporalIndex = state.temporalIndex();
    const active = temporalIndex?.state.nodeActive[Number(attrs.temporalIndex)] === 1;
    const selected = state.selectedId();
    const partner = state.partnerId();
    const graph = state.graph();
    const matchPlayers = state.matchPlayerIds();
    const teamId = state.teamId();
    const teamMatches = teamId == null || (attrs.teams as number[] | undefined)?.includes(teamId);
    const matchMatches = !matchPlayers?.size || matchPlayers.has(node);
    const selectedNeighbors = selected != null && graph?.hasNode(selected) ? new Set(graph.neighbors(selected)) : null;
    const selectionMatches = selectedNeighbors == null || node === selected || selectedNeighbors.has(node);
    const partnerMatches = partner == null || node === selected || node === partner;
    const visible = active && teamMatches && matchMatches && selectionMatches && partnerMatches;
    const result = { ...data, label: visible ? String(attrs.label) : "", color: visible ? data.color : "#cbd5e1", size: selected === node ? 2 : 1.5 } as Record<string, unknown>;
    result.forceLabel = visible && selectedNeighbors != null;
    result.visibility = visible ? "visible" : "hidden";
    return result as Partial<NodeDisplayData>;
  };
}

export function createTemporalEdgeReducer(state: TemporalReducerState) {
  return (edge: string, data: EdgeDisplayData, attrs: Attributes): Partial<EdgeDisplayData> => {
    const graph = state.graph();
    const temporalIndex = state.temporalIndex();
    if (!graph || !temporalIndex) return { ...data, visibility: "hidden" };
    const [source, target] = graph.extremities(edge);
    const temporalEdgeIndex = Number(attrs.temporalIndex);
    const active = temporalIndex.state.edgeActive[temporalEdgeIndex] === 1;
    const count = temporalIndex.state.edgeCounts[temporalEdgeIndex];
    const latest = temporalIndex.state.edgeLatest[temporalEdgeIndex];
    const winRate = temporalIndex.state.edgeWinRateKnown[temporalEdgeIndex] === 1
      ? temporalIndex.state.edgeWinRate[temporalEdgeIndex]
      : null;
    const teamId = state.teamId();
    const sourceTeams = graph.getNodeAttribute(source, "teams") as number[] | undefined;
    const targetTeams = graph.getNodeAttribute(target, "teams") as number[] | undefined;
    const teamMatches = teamId == null || sourceTeams?.includes(teamId) || targetTeams?.includes(teamId);
    const selected = state.selectedId();
    const partner = state.partnerId();
    const selectionMatches = selected == null || source === selected || target === selected;
    const partnerMatches = partner == null || (selected != null && ((source === selected && target === partner) || (target === selected && source === partner)));
    const matchPlayers = state.matchPlayerIds();
    const matchMatches = !matchPlayers?.size || (matchPlayers.has(source) && matchPlayers.has(target));
    const visible = active && teamMatches && selectionMatches && partnerMatches && matchMatches && count >= state.minMatchCount();
    const age = state.time() === Number.NEGATIVE_INFINITY ? 0 : Math.max(0, Math.min(1, 1 - (state.time() - latest) / (365 * 86_400_000)));
    const mode = state.edgeColorMode();
    const color = mode === "winRate" && winRate != null ? `hsl(${Math.round(winRate * 120)} 70% 42%)` : mode === "recency" ? `hsl(${Math.round(age * 220)} 70% 45%)` : "#64748b";
    return { ...data, size: 0.5 + Math.log2(count + 1), color, visibility: visible ? "visible" : "hidden" };
  };
}
