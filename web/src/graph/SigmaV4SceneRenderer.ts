import type Graph from "graphology";
import Sigma from "sigma";
import { sdfCircle, pathCurved } from "sigma/rendering";
import type {
  SceneRendererPort,
  ScenePatch,
  SceneSlotStorage,
} from "../scene/scene";

const PRIMITIVES = {
  nodes: { shapes: [sdfCircle()] },
  edges: { paths: [pathCurved()], extremities: [] },
  depthLayers: ["edges", "selection", "nodes"],
} as const;

const STYLES = {
  nodes: {
    color: { attribute: "color" },
    size: { attribute: "size" },
    opacity: { attribute: "opacity" },
  },
  edges: {
    color: { attribute: "color" },
    size: { attribute: "size" },
    opacity: { attribute: "opacity" },
  },
} as const;

export type SigmaV4RendererOptions = Readonly<{
  hideEdgesOnMove?: boolean;
  hideLabelsOnMove?: boolean;
  labelRenderedSizeThreshold?: number;
}>;

export type SigmaV4SceneRendererHandle = Readonly<{
  renderer: SceneRendererPort;
  sigma: Sigma;
  dispose(): void;
}>;

export function createSigmaV4SceneRenderer(
  graph: Graph,
  container: HTMLElement,
  edgeKeys: readonly (string | null)[],
  options?: SigmaV4RendererOptions,
): SigmaV4SceneRendererHandle {
  const sigma = new Sigma(graph, container, {
    primitives: PRIMITIVES,
    styles: STYLES,
    renderLabels: true,
    renderEdgeLabels: false,
    hideEdgesOnMove: options?.hideEdgesOnMove ?? true,
    hideLabelsOnMove: options?.hideLabelsOnMove ?? true,
    labelRenderedSizeThreshold: options?.labelRenderedSizeThreshold ?? 12,
  });

  let disposed = false;

  const renderer: SceneRendererPort = {
    applyPatch(patch: ScenePatch, slots: SceneSlotStorage): void {
      if (disposed) return;

      const nodeIds: string[] = [];
      for (const range of patch.dirty.nodes) {
        for (let slot = range.start; slot < range.endExclusive; slot++) {
          const record = slots.nodes.records[slot]!;
          const nodeId = record.id;
          graph.setNodeAttribute(nodeId, "x", slots.nodes.x[slot]!);
          graph.setNodeAttribute(nodeId, "y", slots.nodes.y[slot]!);
          graph.setNodeAttribute(nodeId, "size", slots.nodes.scale[slot]! * 6);
          graph.setNodeAttribute(nodeId, "opacity", slots.nodes.alpha[slot]!);
          nodeIds.push(nodeId);
        }
      }

      const edgeIds: string[] = [];
      for (const range of patch.dirty.edges) {
        for (let slot = range.start; slot < range.endExclusive; slot++) {
          const key = edgeKeys[slot];
          if (key == null) continue;
          const sourceSlot = slots.edges.sourceSlots[slot]!;
          const targetSlot = slots.edges.targetSlots[slot]!;
          if (sourceSlot < 0 || targetSlot < 0) continue;

          const sourceId = slots.nodes.records[sourceSlot]!.id;
          const targetId = slots.nodes.records[targetSlot]!.id;

          if (!graph.hasEdge(sourceId, targetId)) {
            graph.addEdge(sourceId, targetId, {
              key,
              size: slots.edges.scale[slot]! * 1.5,
              opacity: slots.edges.alpha[slot]!,
              color: "#64748b",
            });
          } else {
            graph.setEdgeAttribute(sourceId, targetId, "size", slots.edges.scale[slot]! * 1.5);
            graph.setEdgeAttribute(sourceId, targetId, "opacity", slots.edges.alpha[slot]!);
          }
          edgeIds.push(key);
        }
      }

      if (nodeIds.length > 0 || edgeIds.length > 0) {
        sigma.scheduleRefresh({
          partialGraph: { nodes: nodeIds, edges: edgeIds },
          skipIndexation: true,
        });
      }
    },

    render(): void {
      if (disposed) return;
      sigma.refresh();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      sigma.kill();
    },
  };

  return Object.freeze({ renderer, sigma, dispose: renderer.dispose });
}
