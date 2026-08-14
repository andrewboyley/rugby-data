// Camera framing. fitToNodes bounds the node-position bbox only
// (fitViewportToNodes clips edge nodes), so we take the exact fit state and
// shrink the ratio until the largest node keeps a full-radius margin on every
// side.

import { getCameraStateToFitViewportToNodes } from "@sigma/utils";

const RATIO_ITERATIONS = 4;

export function fitToNodes(sigma, graph, nodeKeys, { animate = true } = {}) {
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
	// Which viewport axis does the fit pin against?
	const widthLimiting = groupHeight / groupWidth < height / width;
	const limitDim = widthLimiting ? width : height;
	// Rendered node radius (px) at ratio r, with the default screen
	// size-reference: size / sqrt(ratio).
	const radiusPx = (ratio) => maxSize / Math.sqrt(ratio);
	// The bbox spans `limitDim` px at ratio state.ratio, and pixel width scales
	// as 1/ratio. Find r so bbox + 2·radius fill the viewport:
	//   limitDim·state.ratio / r + 2·radius(r) = limitDim
	// Fixed-point iteration on that constraint:
	let ratio = state.ratio;
	for (let i = 0; i < RATIO_ITERATIONS; i++) {
		ratio = (state.ratio * limitDim) / (limitDim - 2 * radiusPx(ratio));
	}
	const final = { ...state, ratio };
	if (animate) {
		sigma.getCamera().animate(final);
	} else {
		sigma.getCamera().setState(final);
	}
}

export function fitAll(sigma, graph, opts = {}) {
	if (!sigma || !graph || graph.order === 0) return;
	const nodeKeys = [];
	graph.forEachNode((id) => nodeKeys.push(id));
	fitToNodes(sigma, graph, nodeKeys, opts);
}

export function zoomToTeam(sigma, graph, teamId) {
	if (!sigma || !graph) return;
	const nodeKeys = [];
	graph.forEachNode((id, attrs) => {
		if (attrs.team === teamId) nodeKeys.push(id);
	});
	fitToNodes(sigma, graph, nodeKeys);
}