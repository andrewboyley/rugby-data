// Active-edge overlay canvas. The highlighted edge (pinned edge, or the edge
// to a hovered partner) is normally drawn in the "edges" canvas, which sits
// below the nodes canvas. This layer re-strokes it above the nodes so it reads
// as the front-most element, and re-draws the two endpoint nodes above the
// stroke so they stay on top while every other node remains beneath it. The
// overlay is inserted below the node labels so those still render on top.

import { ACTIVE_BORDER_COLOR } from "./colors.js";
import { edgeBaseColor } from "./reducers.js";

// The border program renders its border ring INSIDE the node: the disc spans
// [0, 0.8r] and the ring the band [0.8r, r]. Draw the same layout so the
// overlay is pixel-identical to the node rendered beneath it — an outward
// ring would make the node look bigger on hover.
const DISC_FRACTION = 0.8;
const RING_FRACTION = 0.9;
const MIN_RING_WIDTH = 1;

export function createActiveEdgeOverlay(host, layer, { getSigma, getGraph, state }) {
	layer.style.pointerEvents = "none";

	function draw() {
		const sigma = getSigma();
		const graph = getGraph();
		if (!layer || !sigma || !graph || !host) return;
		const ctx = layer.getContext("2d");

		let key = state.pinnedEdge();
		if (state.pinnedId() != null && state.hoveredOther() != null) {
			const hoverEdge = graph.edge(state.pinnedId(), state.hoveredOther());
			if (hoverEdge != null) key = hoverEdge;
		}

		const width = host.clientWidth;
		const height = host.clientHeight;
		const dpr = window.devicePixelRatio || 1;
		const pixelWidth = Math.round(width * dpr);
		const pixelHeight = Math.round(height * dpr);
		if (layer.width !== pixelWidth || layer.height !== pixelHeight) {
			layer.width = pixelWidth;
			layer.height = pixelHeight;
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);

		if (key == null || !graph.hasEdge(key)) return;
		const attrs = graph.getEdgeAttributes(key);
		const color = edgeBaseColor(graph, attrs);
		if (color == null) return;

		const [a, b] = graph.extremities(key);
		const src = sigma.graphToViewport({ x: graph.getNodeAttribute(a, "x"), y: graph.getNodeAttribute(a, "y") });
		const dst = sigma.graphToViewport({ x: graph.getNodeAttribute(b, "x"), y: graph.getNodeAttribute(b, "y") });
		ctx.beginPath();
		ctx.moveTo(src.x, src.y);
		ctx.lineTo(dst.x, dst.y);
		ctx.strokeStyle = color;
		ctx.lineWidth = sigma.scaleSize(attrs.size);
		ctx.lineCap = "round";
		ctx.stroke();

		// Mirrors the node reducer: only the main active endpoint (pinned) and
		// the clicked edge partner get the white active border. A merely
		// hovered endpoint keeps its default ring — hovering must not make a
		// node look selected.
		const borderFor = (nodeId) =>
			nodeId === state.pinnedId() || nodeId === state.edgePartnerId()
				? ACTIVE_BORDER_COLOR
				: graph.getNodeAttribute(nodeId, "borderColor");
		drawOverlayNode(ctx, sigma, graph, src, a, borderFor(a));
		drawOverlayNode(ctx, sigma, graph, dst, b, borderFor(b));
	}

	return { draw };
}

function drawOverlayNode(ctx, sigma, graph, point, nodeId, borderColor) {
	const radius = sigma.scaleSize(graph.getNodeAttribute(nodeId, "size"));
	ctx.beginPath();
	ctx.arc(point.x, point.y, radius * DISC_FRACTION, 0, Math.PI * 2);
	ctx.fillStyle = graph.getNodeAttribute(nodeId, "color");
	ctx.fill();
	if (borderColor && borderColor !== "transparent") {
		ctx.beginPath();
		ctx.arc(point.x, point.y, radius * RING_FRACTION, 0, Math.PI * 2);
		ctx.strokeStyle = borderColor;
		ctx.lineWidth = Math.max(MIN_RING_WIDTH, 0.2 * radius);
		ctx.stroke();
	}
}