// Team cluster labels: an HTML overlay of divs, one per team, anchored at the
// centroid of that team's nodes. All labels dim together whenever a node is
// activated (pinned/selected), so the inspection view ahead of the focus stays
// readable; once the selection clears they return to full brightness.

import { teamName } from "../lib.js";
import { teamColorOrFallback } from "./colors.js";

export function createClusterLabels(layer, { teams, accentColorOf = teamColorOrFallback }) {
	layer.style.pointerEvents = "none";
	const divs = new Map();

	function clear() {
		for (const div of divs.values()) div.remove();
		divs.clear();
	}

	// Reuse a single DOM node per team; create it lazily with the team's
	// primary colour as a left accent bar.
	function labelFor(teamId, name) {
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

	// Position every label at its cluster centroid and toggle the dim state:
	// one dim for all labels when an activation (pinned node) is present.
	function update(sigma, graph, interactedNodeIds) {
		const groups = new Map();
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
			div.classList.toggle("sigma-cluster-dim", dimmed);
		}
	}

	return { update, clear };
}