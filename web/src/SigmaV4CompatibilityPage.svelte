<script lang="ts">
  import { onDestroy } from "svelte";
  import Graph from "graphology";
  import Sigma from "sigma";
  import { sdfCircle, pathCurved } from "sigma/rendering";
  import { bindWebGLLayer, createContoursProgram } from "@sigma/layer-webgl";

  type SpikeState = { selected: boolean };
  const primitives = {
    nodes: { shapes: [sdfCircle()] },
    edges: { paths: [pathCurved()], extremities: [] },
    depthLayers: ["edges", "selection", "nodes"],
  } as const;
  type CompatibilityPrimitives = typeof primitives;

  const graph = new Graph();
  graph.addNode("first", { x: 0, y: 0, size: 12, color: "#2563eb", label: "First" });
  graph.addNode("second", { x: 1, y: 1, size: 12, color: "#f97316", label: "Second" });
  graph.addEdge("first", "second", { color: "#64748b", size: 2, type: "curved" });

  let host = $state<HTMLElement | null>(null);
  let renderer: Sigma<{}, {}, {}, SpikeState, {}, {}, CompatibilityPrimitives> | null = null;
  let cleanupLayer: (() => void) | null = null;
  let selected = $state<string | null>(null);

  function disposeRenderer(): void {
    cleanupLayer?.();
    cleanupLayer = null;
    renderer?.kill();
    renderer = null;
    sessionStorage.setItem("sigma-v4-spike-disposed", "true");
  }

  function createRenderer(container: HTMLElement): void {
    const nextRenderer = new Sigma<{}, {}, {}, SpikeState, {}, {}, CompatibilityPrimitives>(graph, container, {
      primitives,
      styles: {
        nodes: { color: { attribute: "color" }, size: { attribute: "size" } },
        edges: { color: { attribute: "color" }, size: { attribute: "size" } },
      },
    });

    cleanupLayer = bindWebGLLayer(
      "selection",
      nextRenderer,
      createContoursProgram(graph.nodes()),
      "compatibility-contours",
    );
    nextRenderer.on("clickNode", ({ node }) => {
      if (selected) nextRenderer.setNodeState(selected, { selected: false });
      selected = node;
      nextRenderer.setNodeState(node, { selected: true });
      nextRenderer.scheduleRefresh({ partialGraph: { nodes: [node] }, skipIndexation: true });
    });
    renderer = nextRenderer;
    window.__sigmaV4Compatibility = {
      selected: () => selected,
      state: (node) => nextRenderer.getNodeState(node),
      nodeViewport: (node: string) => {
        const attributes = graph.getNodeAttributes(node);
        return nextRenderer.graphToViewport({ x: Number(attributes.x), y: Number(attributes.y) });
      },
      dispose: disposeRenderer,
    };
  }

  $effect(() => {
    if (host && !renderer) createRenderer(host);
    return () => {
      disposeRenderer();
      delete window.__sigmaV4Compatibility;
    };
  });

  onDestroy(() => {
    disposeRenderer();
  });
</script>

<main class="relative h-screen" data-testid="sigma-v4-spike" bind:this={host}></main>
