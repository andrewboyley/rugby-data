// Sigma reducers. Each reads the live interaction state (hover/pin) through a
// getter object and returns the reduced attributes sigma renders. Keeping the
// reducer logic outside the component makes the focus rules testable.

import {
	ACTIVE_BORDER_COLOR,
	DIMMED_NODE_COLOR,
	SHARED_MATCH_COLOR,
	applyAlpha,
	needsBorder,
} from "./colors.js";

// The colour an edge carries in the current mode at full opacity.
export function edgeBaseColor(graph, attrs) {
	const mode = graph.getAttribute("edgeColorMode");
	if (mode === "winrate") return attrs.wr;
	return SHARED_MATCH_COLOR;
}

export function createNodeReducer(state) {
	return (node, data) => reduceNode(node, data, state);
}

function reduceNode(node, data, state) {
	const res = { ...data };
	const { focusId, focusNeighbors, hoveredId, hoveredOther, pinnedId, edgePartnerId } = state;
	const focus = focusId();
	const isHovered = node === hoveredId() || node === hoveredOther();
	const isActive = pinnedId() != null && node === pinnedId();
	const isSecondary = focus != null && focusNeighbors().has(node);
	const partner = edgePartnerId();
	const isSecondaryActive = node === partner;

	res.isActive = isActive;
	res.isSecondary = isSecondary;
	res.isHovered = isHovered;

	// Labels appear only on hover, or permanently for the active (selected)
	// node and the clicked edge partner. Blank the label of every other node,
	// since sigma reads this same reduced attribute for both the regular label
	// pass and the hover label box. forceLabel keeps labels visible even below
	// the zoom size threshold.
	if (isActive || isSecondaryActive || isHovered) {
		res.forceLabel = true;
	} else {
		res.label = "";
	}

	res.type = "border";
	if (focus != null) {
		if (isActive) {
			res.type = "activeBorder";
		} else if (isSecondaryActive) {
			res.borderColor = ACTIVE_BORDER_COLOR;
		} else if (!isSecondary && !isHovered) {
			res.label = "";
			res.color = DIMMED_NODE_COLOR;
			res.borderColor = "transparent";
		}
	}

	if (isActive) {
		res.borderColor = ACTIVE_BORDER_COLOR;
	} else if (res.borderColor === undefined) {
		res.borderColor = needsBorder(res.color);
	}
	return res;
}

export function createEdgeReducer(state) {
	return (edge, data) => reduceEdge(edge, data, state);
}

function reduceEdge(edge, data, state) {
	const res = { ...data };
	const {
		graph: graphGetter,
		focusId,
		focusNeighbors,
		pinnedId,
		pinnedNeighbors,
		pinnedEdge,
		hoveredOther,
		showEdges,
		alphaMin,
		alphaMax,
	} = state;
	const g = graphGetter();
	const aMin = Math.min(
		Number(g.getAttribute("edgeAlphaMin") ?? alphaMin()),
		Number(g.getAttribute("edgeAlphaMax") ?? alphaMax()),
	);
	const aMax = Math.max(
		Number(g.getAttribute("edgeAlphaMin") ?? alphaMin()),
		Number(g.getAttribute("edgeAlphaMax") ?? alphaMax()),
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
	const alpha = aMin + (aMax - aMin) * Math.min(1, Math.max(0, data.recency ?? 0.5));
	res.color = applyAlpha(base, alpha);

	const pinned = pinnedId();
	if (pinned != null) {
		const [a, b] = g.extremities(edge);
		const joinsPinned =
			(a === pinned && pinnedNeighbors().has(b)) || (b === pinned && pinnedNeighbors().has(a));
		const hovered = hoveredOther();
		const joinsHoveredOther =
			hovered != null && a !== b && ((a === pinned && b === hovered) || (b === pinned && a === hovered));
		if (edge === pinnedEdge()) {
			res.color = base;
		} else if (joinsHoveredOther) {
			res.color = base;
		} else if (!joinsPinned) {
			res.hidden = true;
		}
		return res;
	}

	const pinnedEdgeKey = pinnedEdge();
	if (pinnedEdgeKey != null) {
		if (edge === pinnedEdgeKey) res.color = base;
		else res.hidden = true;
		return res;
	}

	const focus = focusId();
	if (focus == null) {
		// No active node: keep the mode/alpha-styled colour above, without
		// stamping any visibility. Return the computed res, not the raw
		// attributes, otherwise build-time winrate colours leak through in
		// "Shared matches" mode.
		if (!showEdges()) res.hidden = true;
		return res;
	}
	const [a, b] = g.extremities(edge);
	const adjacent = (a === focus && focusNeighbors().has(b)) || (b === focus && focusNeighbors().has(a));
	if (!adjacent) res.hidden = true;
	return res;
}