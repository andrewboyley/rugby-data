// Team cluster labels: HTML overlay positioned at each team's centroid.

import { teamName } from "../lib.ts";
import { teamColorOrFallback } from "./colors.ts";
import type { Sigma } from "sigma";
import type Graph from "graphology";

export interface ClusterLabels {
  update(
    sigma: Sigma,
    graph: Graph,
    interactedNodeIds: (string | null)[],
    hoveredTeamId?: number | null,
  ): void;
  clear(): void;
}

export function createClusterLabels(
  layer: HTMLElement,
  opts: {
    teams: Record<number, { name: string; color: string }>;
    accentColorOf?: typeof teamColorOrFallback;
  },
): ClusterLabels {
  layer.style.pointerEvents = "none";
  const divs = new Map<number, HTMLDivElement>();
  const { teams, accentColorOf = teamColorOrFallback } = opts;

  function clear(): void {
    for (const div of divs.values()) div.remove();
    divs.clear();
  }

  function labelFor(teamId: number, name: string): HTMLDivElement {
    let div = divs.get(teamId);
    if (!div) {
      div = document.createElement("div");
      div.className = "sigma-cluster";
      div.style.setProperty("--cluster-accent", accentColorOf(teams, teamId));
      layer.appendChild(div);
      divs.set(teamId, div);
    }
    div.textContent = name;
    return div;
  }

  function update(
    sigma: Sigma,
    graph: Graph,
    interactedNodeIds: (string | null)[],
    hoveredTeamId: number | null = null,
  ): void {
    const groups = new Map<number, { sx: number; sy: number; count: number }>();
    graph.forEachNode((_key, attrs) => {
      if (attrs.team == null) return;
      let group = groups.get(attrs.team);
      if (!group) {
        group = { sx: 0, sy: 0, count: 0 };
        groups.set(attrs.team, group);
      }
      group.sx += attrs.x;
      group.sy += attrs.y;
      group.count++;
    });

    const dimmed = interactedNodeIds.some((id) => id != null);

    for (const [teamId] of groups) {
      if (!divs.has(teamId)) labelFor(teamId, teamName(teams, teamId));
    }
    for (const [teamId, div] of divs) {
      const group = groups.get(teamId);
      if (!group) {
        div.style.display = "none";
        continue;
      }
      const point = sigma.graphToViewport({ x: group.sx / group.count, y: group.sy / group.count });
      div.style.display = "block";
      div.style.left = `${point.x}px`;
      div.style.top = `${point.y}px`;
      const oppositeTeamDimmed = hoveredTeamId != null && teamId !== hoveredTeamId;
      div.classList.toggle("sigma-cluster-dim", dimmed || oppositeTeamDimmed);
    }
  }

  return { update, clear };
}
