import { pairKey } from "../temporal/types";
import type { EdgeDelta, NodeId, PairKey } from "../temporal/types";

export type EdgeDetailContext = Readonly<{
  selectedId: NodeId | null;
  partnerId: NodeId | null;
  matchPlayerIds: ReadonlySet<NodeId> | null;
}>;

/**
 * Keep interaction context visible outside ordinary edge-detail budget.
 * Callers retain the complete temporal edge collection as their source of truth.
 */
export function projectBoundedEdges(
  activeEdges: readonly EdgeDelta[],
  ordinaryBudget: number,
  context: EdgeDetailContext,
): readonly EdgeDelta[] {
  if (!Number.isSafeInteger(ordinaryBudget) || ordinaryBudget < 0) {
    throw new RangeError("ordinaryBudget must be a non-negative safe integer");
  }

  const byKey = new Map<PairKey, EdgeDelta>();
  for (const edge of activeEdges) {
    if (edge.count <= 0) continue;
    byKey.set(pairKey(edge.source, edge.target), edge);
  }

  const ranked = [...byKey.values()].sort((left, right) =>
    right.count - left.count ||
    (right.latest ?? Number.NEGATIVE_INFINITY) - (left.latest ?? Number.NEGATIVE_INFINITY) ||
    pairKey(left.source, left.target).localeCompare(pairKey(right.source, right.target)),
  );
  const reserved = new Set<PairKey>();

  for (const edge of ranked) {
    const touchesSelected = context.selectedId != null &&
      (edge.source === context.selectedId || edge.target === context.selectedId);
    const joinsPartner = context.selectedId != null && context.partnerId != null &&
      ((edge.source === context.selectedId && edge.target === context.partnerId) ||
        (edge.target === context.selectedId && edge.source === context.partnerId));
    const joinsMatch = context.matchPlayerIds != null && context.matchPlayerIds.size > 0 &&
      context.matchPlayerIds.has(edge.source) && context.matchPlayerIds.has(edge.target);
    if (touchesSelected || joinsPartner || joinsMatch) {
      reserved.add(pairKey(edge.source, edge.target));
    }
  }

  const projected: EdgeDelta[] = [];
  for (const edge of ranked) {
    if (reserved.has(pairKey(edge.source, edge.target))) projected.push(edge);
  }
  for (const edge of ranked) {
    if (projected.length >= reserved.size + ordinaryBudget) break;
    if (!reserved.has(pairKey(edge.source, edge.target))) projected.push(edge);
  }
  return Object.freeze(projected);
}
