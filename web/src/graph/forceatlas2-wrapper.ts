// ForceAtlas2 wrapper to avoid TypeScript overload resolution issues
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { ForceAtlas2SynchronousLayoutParameters } from "graphology-layout-forceatlas2";

/**
 * Runs ForceAtlas2 with the given parameters object.
 * This wrapper avoids TypeScript overload resolution issues with forceAtlas2.
 */
export function runForceAtlas2(graph: Graph, options: ForceAtlas2SynchronousLayoutParameters): void {
  forceAtlas2(graph, options);
}