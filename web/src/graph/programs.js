// Sigma render programs and the node label painter.

import { createNodeBorderProgram } from "@sigma/node-border";
import { LABEL_COLOR, SHARED_MATCH_COLOR } from "./colors.js";

// No-op hover renderer: the hovered node's label is already drawn by the
// normal label pass (hovered/blurred logic in the node reducer), and sigma's
// default hover would draw a halo that makes the node look bigger. Drawing
// nothing keeps the node's size unchanged on hover.
function noopHover() {}

// One program serves both "border" and "activeBorder" node types: the border
// ring inside the disc, plus the disc fill. The reducer switches a selected
// node to the activeBorder type to keep its ring white.
const BORDER_PROGRAM = createNodeBorderProgram({
	drawHover: noopHover,
	borders: [
		{ color: { attribute: "borderColor" }, size: { value: 0.2 } },
		{ color: { attribute: "color" }, size: { fill: true } },
	],
});

export function sigmaOptions({ nodeReducer, edgeReducer }) {
	return {
		labelColor: { color: LABEL_COLOR },
		defaultEdgeColor: SHARED_MATCH_COLOR,
		nodeProgramClasses: {
			border: BORDER_PROGRAM,
			activeBorder: BORDER_PROGRAM,
		},
		defaultDrawNodeLabel: drawNodeLabel,
		nodeReducer,
		edgeReducer,
	};
}

// Nodes from "nodeProgramClasses" that are not a <circle> are drawn with no
// default label. This painter reproduces sigma's text rendering with an
// outline so labels stay readable on top of edges and other nodes.
export function drawNodeLabel(context, data, settings) {
	if (!data.label) return;
	const fontSize = settings.labelSize;
	const font = settings.labelFont;
	context.font = `${settings.labelWeight || ""} ${fontSize}px ${font}`;

	const x = data.x + data.size + 4;
	const y = data.y + fontSize / 3;

	context.strokeStyle = "#000000";
	context.lineWidth = 3;
	context.strokeText(data.label, x, y);

	context.fillStyle = settings.labelColor.color;
	context.fillText(data.label, x, y);
}