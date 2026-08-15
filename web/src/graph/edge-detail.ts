// Builds the payload the Hud shows when an edge is selected.

import type Graph from "graphology";
import type { EdgeSelection } from "../types.ts";

export function edgeSelection(
  graph: Graph,
  edge: string,
  teamOverride: number | undefined,
): EdgeSelection {
  const [a, b] = graph.extremities(edge);
  const attrs = graph.getEdgeAttributes(edge);
  const team =
    teamOverride !== undefined
      ? teamOverride
      : (graph.getNodeAttribute(a, "team") as number | null) ??
        (graph.getNodeAttribute(b, "team") as number | null);
  return {
    key: edge,
    a: graph.getNodeAttribute(a, "name") as string,
    b: graph.getNodeAttribute(b, "name") as string,
    source: a,
    target: b,
    team,
    w: attrs.w as number,
    dates: (attrs.dates as string[]) || [],
  };
}

export function gameKey(game: { eventId: number }): string {
  return `${game.eventId}`;
}
