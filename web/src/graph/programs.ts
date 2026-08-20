// Sigma v4 constructor options for the rugby graph.

import type { Settings } from "sigma/settings";
import type { NodeReducer, EdgeReducer } from "sigma/types";
import type { StylesDeclaration, PrimitivesDeclaration } from "sigma/types";
import { sdfCircle, pathCurved } from "sigma/rendering";
import { layerBorder } from "@sigma/node-border";
import { LABEL_COLOR, SHARED_MATCH_COLOR } from "./colors.ts";

export function createSigmaOptions(opts: {
  nodeReducer: NodeReducer;
  edgeReducer: EdgeReducer;
}) {
  return {
    nodeReducer: opts.nodeReducer,
    edgeReducer: opts.edgeReducer,
    // "screen" keeps node sizes in a fixed on-screen scale rather than tying
    // them to the graph's coordinate extent. The ForceAtlas2 layout spreads the
    // graph across thousands of raw units, so the default "positions" mode makes
    // sigma's sizeRatio huge and renders every node sub-pixel (invisible).
    settings: { itemSizesReference: "screen" } as Partial<Settings>,
    primitives: {
      nodes: {
        shapes: [sdfCircle()],
        layers: [
          layerBorder({
            borders: [
              { size: 0.2, color: { attribute: "borderColor" }, mode: "relative" },
              { size: 0, color: { attribute: "color" }, fill: true },
            ],
          }),
        ],
      } as any,
      edges: {
        paths: [pathCurved()],
        extremities: [],
      } as any,
      depthLayers: ["edges", "topEdges", "nodes", "topNodes"],
    } as unknown as PrimitivesDeclaration,
    styles: {
      nodes: {
        // Read the node's own colour attributes. When a `styles` declaration is
        // present sigma resolves display colours from the style defaults (which
        // default `color` to "#666") instead of the node's `color` attribute, so
        // we must explicitly map them back.
        color: { attribute: "color" },
        borderColor: { attribute: "borderColor" },
        labelColor: LABEL_COLOR,
        labelBackgroundColor: "#ffffffcc",
        labelBackgroundPadding: 3,
      },
      edges: [{ color: SHARED_MATCH_COLOR }],
    } as StylesDeclaration,
  };
}