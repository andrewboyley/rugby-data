import type Graph from "graphology";
import Sigma from "sigma";
import {
  selectRendererAdapter as selectAdapter,
  type RendererFeaturePolicy,
} from "./renderer-policy";

export type RendererAdapter = Readonly<{
  create: (
    graph: Graph,
    container: HTMLElement,
    settings: ConstructorParameters<typeof Sigma>[2],
  ) => Sigma;
}>;

export const baselineRenderer: RendererAdapter = Object.freeze({
  create: (graph, container, settings) => new Sigma(graph, container, settings),
});

export function selectRendererAdapter(
  policy: RendererFeaturePolicy,
  advancedRenderer: RendererAdapter | null,
): RendererAdapter {
  return selectAdapter(policy, baselineRenderer, advancedRenderer);
}
