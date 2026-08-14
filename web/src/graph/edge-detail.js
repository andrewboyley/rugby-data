// Builds the payload the Hud shows when an edge is selected (via canvas click
// or a partner-chip click in the panel).

export function edgeSelection(graph, edge, teamOverride) {
	const [a, b] = graph.extremities(edge);
	const attrs = graph.getEdgeAttributes(edge);
	const team =
		teamOverride !== undefined
			? teamOverride
			: graph.getNodeAttribute(a, "team") ?? graph.getNodeAttribute(b, "team");
	return {
		key: edge,
		a: graph.getNodeAttribute(a, "name"),
		b: graph.getNodeAttribute(b, "name"),
		source: a,
		target: b,
		team,
		w: attrs.w,
		dates: attrs.dates || [],
	};
}

// Stable key identifying a game in the match history, independent of ordering.
export function gameKey(game) {
	return `${game.eventId}`;
}