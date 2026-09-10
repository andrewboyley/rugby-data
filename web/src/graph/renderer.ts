import type Graph from "graphology";
import Sigma from "sigma";
import {
  selectRendererAdapter as selectAdapter,
  type RendererFeaturePolicy,
} from "./renderer-policy";
import {
  createSigmaV4SceneRenderer,
  type SigmaV4RendererOptions,
} from "./SigmaV4SceneRenderer";

export type RendererAdapter = Readonly<{
  create: (
    graph: Graph,
    container: HTMLElement,
    settings: ConstructorParameters<typeof Sigma>[2],
  ) => Sigma;
  /** Scene port for the new viewer path; undefined for the baseline adapter. */
  sceneRenderer?: (
    graph: Graph,
    container: HTMLElement,
    edgeKeys: readonly (string | null)[],
    options?: SigmaV4RendererOptions,
  ) => import("./SigmaV4SceneRenderer").SigmaV4SceneRendererHandle;
}>;

export const baselineRenderer: RendererAdapter = Object.freeze({
  create: (graph, container, settings) => new Sigma(graph, container, settings),
});

export const v4Renderer: RendererAdapter = Object.freeze({
  create: (graph, container, settings) => new Sigma(graph, container, settings),
  sceneRenderer: createSigmaV4SceneRenderer,
});

export function selectRendererAdapter(
  policy: RendererFeaturePolicy,
  advancedRenderer: RendererAdapter | null,
): RendererAdapter {
  return selectAdapter(policy, baselineRenderer, advancedRenderer);
}
