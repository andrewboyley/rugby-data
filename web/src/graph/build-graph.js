// Builds the graphology graph forwarded to sigma from the filtered view
// nodes/links. Pure with respect to its inputs: the caller passes the colour
// mode, teams and win-rate map it closes over.

import { UndirectedGraph } from "graphology";
import { edgeKey } from "../lib.js";
import {
	applyAlpha,
	alphaOf,
	needsBorder,
	nodeFillColor,
	teamSecondaryColorOrNull,
	winRateColor,
	SHARED_MATCH_COLOR,
} from "./colors.js";
import { edgeSize, nodeSize } from "./sizes.js";

// Random start position spread (graph units) before the layout settles.
const INITIAL_JITTER_SPREAD = 4;

export function buildGraph({
	nodes,
	links,
	prevPos,
	teams,
	nodeColorMode,
	edgeColorMode,
	alphaMin,
	alphaMax,
	winRates,
}) {
	const graph = new UndirectedGraph();
	const maxApp = Math.max(1, ...nodes.map((n) => n.app || 0));
	const maxWeight = Math.max(1, ...links.map((l) => l.w));
	graph.setAttribute("edgeColorMode", edgeColorMode);
	graph.setAttribute("edgeAlphaMin", alphaMin);
	graph.setAttribute("edgeAlphaMax", alphaMax);

	for (const n of nodes) {
		graph.addNode(String(n.id), nodeAttributes(n, { prevPos, teams, nodeColorMode, maxApp }));
	}
	let edgeSeq = 0;
	for (const link of links) {
		graph.addEdgeWithKey(
			String(edgeSeq++),
			String(link.source.id),
			String(link.target.id),
			edgeAttributes(link, { winRates, maxWeight, alphaMin, alphaMax }),
		);
	}
	return graph;
}

// The border follows the team's secondary (home) colour — e.g. South Africa's
// gold — lightened enough to read on the dark background. Falls back to the
// fill colour when the node has no team strip.
function nodeAttributes(node, { prevPos, teams, nodeColorMode, maxApp }) {
	const p = prevPos?.get(node.id);
	const fill = nodeFillColor(nodeColorMode, { teams, teamId: node.team, jersey: node.jersey });
	return {
		label: node.name,
		color: fill,
		type: "border",
		borderColor: needsBorder(teamSecondaryColorOrNull(teams, node.team) || fill),
		size: nodeSize(node, maxApp),
		x: p?.x ?? Math.random() * INITIAL_JITTER_SPREAD - INITIAL_JITTER_SPREAD / 2,
		y: p?.y ?? Math.random() * INITIAL_JITTER_SPREAD - INITIAL_JITTER_SPREAD / 2,
		name: node.name,
		team: node.team,
		jersey: node.jersey,
		app: node.app,
		deg: node.deg,
	};
}

function edgeAttributes(link, { winRates, maxWeight, alphaMin, alphaMax }) {
	const winRate = winRates.get(edgeKey(link.source.id, link.target.id));
	const recency = link.recency;
	const base = winRate != null ? winRateColor(winRate) : SHARED_MATCH_COLOR;
	return {
		weight: link.w,
		size: edgeSize(link.w, maxWeight),
		w: link.w,
		dates: link.dates || [],
		recency,
		wr: winRate != null ? winRateColor(winRate) : null,
		color: applyAlpha(base, alphaOf(recency, alphaMin, alphaMax)),
	};
}