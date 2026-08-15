// Sigma render programs and the custom node label painter.

import type { Settings } from "sigma/settings";
import { createNodeBorderProgram } from "@sigma/node-border";
import { LABEL_COLOR, SHARED_MATCH_COLOR } from "./colors.ts";

function noopHover(): void {}

const BORDER_PROGRAM = createNodeBorderProgram({
  drawHover: noopHover,
  borders: [
    { color: { attribute: "borderColor" }, size: { value: 0.2 } },
    { color: { attribute: "color" }, size: { fill: true } },
  ],
});

export interface SigmaOptions {
  labelColor: { color: string };
  defaultEdgeColor: string;
  nodeProgramClasses: Record<string, unknown>;
  defaultDrawNodeLabel: (context: unknown, data: unknown, settings: unknown) => void;
  nodeReducer: (node: string, data: Record<string, unknown>) => Record<string, unknown>;
  edgeReducer: (edge: string, data: Record<string, unknown>) => Record<string, unknown>;
}

export function sigmaOptions(opts: {
  nodeReducer: (node: string, data: Record<string, unknown>) => Record<string, unknown>;
  edgeReducer: (edge: string, data: Record<string, unknown>) => Record<string, unknown>;
}): Partial<Settings> {
  return {
    labelColor: { color: LABEL_COLOR },
    defaultEdgeColor: SHARED_MATCH_COLOR,
    nodeProgramClasses: {
      border: BORDER_PROGRAM,
      activeBorder: BORDER_PROGRAM,
    },
    defaultDrawNodeLabel: drawNodeLabel,
    nodeReducer: opts.nodeReducer,
    edgeReducer: opts.edgeReducer,
  } as Partial<Settings>;
}

// Custom label painter: adds a dark outline so labels stay readable
// on top of edges and other nodes.
export function drawNodeLabel(
  context: CanvasRenderingContext2D,
  data: { label?: string; x: number; y: number; size: number },
  settings: { labelSize: number; labelFont: string; labelWeight?: string; labelColor: { color: string } },
): void {
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
