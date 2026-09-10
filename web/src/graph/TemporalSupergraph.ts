import { UndirectedGraph } from "graphology";
import type { TemporalIndex } from "../temporal/TemporalIndex";
import type { DatasetLike, NodeId } from "../temporal/types";

export type TemporalSupergraph = Readonly<{
  graph: UndirectedGraph;
}>;

/**
 * All-time co-occurrence counts use square-root attraction. This keeps frequent
 * partnerships stronger without allowing them to dominate every FA2 iteration.
 */
export function allTimeLayoutWeight(count: number): number {
  return Math.sqrt(Math.max(1, count));
}

export function createTemporalSupergraph(dataset: DatasetLike, temporalIndex: TemporalIndex): TemporalSupergraph {
  const graph = new UndirectedGraph();
  const teamsByNode = new Map<NodeId, Set<number>>();

  for (const match of temporalIndex.timeline.matches) {
    for (const nodeId of match.players) {
      const teams = teamsByNode.get(nodeId) ?? new Set<number>();
      teams.add(match.teamId);
      teamsByNode.set(nodeId, teams);
    }
  }

  temporalIndex.nodeIds.forEach((nodeId, temporalNodeIndex) => {
    const teams = [...(teamsByNode.get(nodeId) ?? [])].sort((left, right) => left - right);
    const coachId = nodeId.startsWith("c_") ? nodeId.slice(2) : null;
    const count = temporalIndex.allTimeNodeCounts[temporalNodeIndex];
    const angle = (temporalNodeIndex / temporalIndex.nodeIds.length) * Math.PI * 2;
    graph.addNode(nodeId, {
      x: Math.cos(angle) * 100,
      y: Math.sin(angle) * 100,
      label: coachId == null ? dataset.players?.[nodeId] ?? nodeId : dataset.coaches?.[coachId] ?? nodeId,
      isCoach: coachId != null,
      teams,
      team: teams[0] ?? null,
      temporalIndex: temporalNodeIndex,
      allTimeCount: count,
      size: Math.max(1, count),
    });
  });

  temporalIndex.edgeRecords.forEach((edge, temporalEdgeIndex) => {
    const count = temporalIndex.allTimeEdgeCounts[temporalEdgeIndex];
    graph.addEdgeWithKey(edge.key, edge.source, edge.target, {
      temporalIndex: temporalEdgeIndex,
      allTimeCount: count,
      matchCount: count,
      weight: allTimeLayoutWeight(count),
      size: 0.5 + Math.log2(count + 1),
    });
  });

  return Object.freeze({ graph });
}

/** Creates the immutable, all-time topology owned only by the FA2 worker. */
export function createAllTimeLayoutTopology(
  dataset: DatasetLike,
  temporalIndex: TemporalIndex,
): TemporalSupergraph {
  return createTemporalSupergraph(dataset, temporalIndex);
}
