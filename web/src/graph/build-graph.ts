// Builds a graphology UndirectedGraph from the filtered view nodes/links.

import { UndirectedGraph } from "graphology";
import { edgeKey } from "../lib.ts";
import type { Link, Player } from "../types.ts";
import {
  applyAlpha,
  alphaOf,
  needsBorder,
  nodeFillColor,
  teamSecondaryColorOrNull,
  SHARED_MATCH_COLOR,
  winRateColor,
} from "./colors.ts";
import { nodeSize, edgeSize } from "./sizes.ts";

const INITIAL_JITTER_SPREAD = 4;

export interface _BuildGraphOpts {
  nodes: Player[];
  links: Link[];
  prevPos: Map<number, { x: number; y: number }>;
  teams: Record<number, { name: string; color: string; alternateColor?: string }>;
  nodeColorMode: string;
  edgeColorMode: string;
  alphaMin: number;
  alphaMax: number;
  winRates: Map<string, number>;
}

export function buildGraph(opts: _BuildGraphOpts): UndirectedGraph {
  const { nodes, links, prevPos, teams, nodeColorMode, edgeColorMode, alphaMin, alphaMax, winRates } = opts;

  const graph = new UndirectedGraph();
  const maxApp = Math.max(1, ...nodes.map((n) => n.app || 0));
  const maxWeight = Math.max(1, ...links.map((l) => l.w));

  graph.setAttribute("edgeColorMode", edgeColorMode);
  graph.setAttribute("edgeAlphaMin", alphaMin);
  graph.setAttribute("edgeAlphaMax", alphaMax);

  for (const n of nodes) {
    graph.addNode(String(n.id), nodeAttributes(n, { prevPos, teams, nodeColorMode, maxApp }));
  }

  let edgeSeq = 0;
  for (const link of links) {
    graph.addEdgeWithKey(
      String(edgeSeq++),
      String(link.source.id),
      String(link.target.id),
      edgeAttributes(link, { winRates, maxWeight, alphaMin, alphaMax }),
    );
  }
  return graph;
}

interface NodeAttrOpts {
  prevPos: Map<number, { x: number; y: number }>;
  teams: Record<number, { name: string; color: string; alternateColor?: string }>;
  nodeColorMode: string;
  maxApp: number;
}

function nodeAttributes(node: Player, opts: NodeAttrOpts): Record<string, unknown> {
  const p = opts.prevPos.get(node.id);
  const fill = nodeFillColor(opts.nodeColorMode, {
    teams: opts.teams,
    teamId: node.team,
    jersey: node.jersey,
  });
  const border = needsBorder(
    teamSecondaryColorOrNull(opts.teams, node.team) || fill
  );
  return {
    label: node.name,
    color: fill,
    type: "border",
    borderColor: border,
    size: nodeSize(node, opts.maxApp),
    x: p?.x ?? Math.random() * INITIAL_JITTER_SPREAD - INITIAL_JITTER_SPREAD / 2,
    y: p?.y ?? Math.random() * INITIAL_JITTER_SPREAD - INITIAL_JITTER_SPREAD / 2,
    name: node.name,
    team: node.team,
    jersey: node.jersey,
    app: node.app,
    deg: node.deg,
  };
}

interface EdgeAttrOpts {
  winRates: Map<string, number>;
  maxWeight: number;
  alphaMin: number;
  alphaMax: number;
}

function edgeAttributes(link: Link, opts: EdgeAttrOpts): Record<string, unknown> {
  const winRate = opts.winRates.get(edgeKey(link.source.id, link.target.id));
  const recency = link.recency;
  const base = winRate != null ? winRateColor(winRate) : SHARED_MATCH_COLOR;
  return {
    weight: link.w,
    size: edgeSize(link.w, opts.maxWeight),
    w: link.w,
    dates: link.dates || [],
    recency,
    wr: winRate != null ? winRateColor(winRate) : null,
    color: applyAlpha(base, alphaOf(recency, opts.alphaMin, opts.alphaMax)),
  };
}
