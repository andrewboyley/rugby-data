import { emptyDelta, pairKey, pairNodes, type Delta, type EdgeDelta, type Match, type NodeId, type PairKey } from "./types";
import { MatchTimeline } from "./MatchTimeline";

export class TemporalAccumulator {
  readonly playerCounts = new Map<NodeId, number>();
  readonly pairCounts = new Map<PairKey, number>();
  private readonly pairContributions = new Map<PairKey, Array<{ timestamp: number; won: boolean | null }>>();
  private cursor = 0;
  currentTime = Number.NEGATIVE_INFINITY;

  constructor(readonly timeline: MatchTimeline) {}

  seek(targetTime: number): Delta {
    if (!Number.isFinite(targetTime) && targetTime !== Number.NEGATIVE_INFINITY) throw new TypeError("targetTime must be finite");
    const delta = emptyDelta();
    if (targetTime >= this.currentTime) {
      while (this.cursor < this.timeline.matches.length && this.timeline.matches[this.cursor].timestamp <= targetTime) this.applyMatch(this.timeline.matches[this.cursor++], 1, delta);
    } else {
      while (this.cursor > 0 && this.timeline.matches[this.cursor - 1].timestamp > targetTime) this.applyMatch(this.timeline.matches[--this.cursor], -1, delta);
    }
    this.currentTime = targetTime;
    return delta;
  }

  applyMatch(match: Match, direction: 1 | -1, delta = emptyDelta()): Delta {
    for (const node of match.players) this.changeNode(node, direction, delta);
    for (let left = 0; left < match.players.length; left++) for (let right = left + 1; right < match.players.length; right++) this.changePair(match, match.players[left], match.players[right], direction, delta);
    return delta;
  }

  snapshot(): { players: [NodeId, number][]; pairs: [PairKey, number][]; cursor: number; currentTime: number } {
    return { players: [...this.playerCounts].sort(), pairs: [...this.pairCounts].sort(), cursor: this.cursor, currentTime: this.currentTime };
  }

  private changeNode(node: NodeId, direction: 1 | -1, delta: Delta): void {
    const previous = this.playerCounts.get(node) ?? 0;
    const next = previous + direction;
    console.assert(next >= 0, `negative player count for ${node}`);
    if (next < 0) throw new RangeError(`negative player count for ${node}`);
    if (next === 0) this.playerCounts.delete(node); else this.playerCounts.set(node, next);
    if (previous === 0 && next === 1) delta.addNodes.push(node);
    if (previous === 1 && next === 0) delta.removeNodes.push(node);
  }

  private changePair(match: Match, a: NodeId, b: NodeId, direction: 1 | -1, delta: Delta): void {
    const key = pairKey(a, b);
    const previous = this.pairCounts.get(key) ?? 0;
    const next = previous + direction;
    console.assert(next >= 0, `negative pair count for ${key}`);
    if (next < 0) throw new RangeError(`negative pair count for ${key}`);
    if (next === 0) this.pairCounts.delete(key); else this.pairCounts.set(key, next);
    const contributions = this.pairContributions.get(key) ?? [];
    if (direction === 1) contributions.push({ timestamp: match.timestamp, won: match.won }); else contributions.pop();
    if (contributions.length) this.pairContributions.set(key, contributions); else this.pairContributions.delete(key);
    const [source, target] = pairNodes(key);
    const edge = this.edgeDelta(source, target, next, contributions);
    if (previous === 0 && next === 1) delta.addEdges.push(edge);
    else if (previous === 1 && next === 0) delta.removeEdges.push({ source, target });
    else delta.updateEdges.push(edge);
  }

  private edgeDelta(source: NodeId, target: NodeId, count: number, contributions: Array<{ timestamp: number; won: boolean | null }>): EdgeDelta {
    const decided = contributions.filter((entry) => entry.won != null);
    return { source, target, count, latest: Math.max(...contributions.map((entry) => entry.timestamp)), winRate: decided.length ? decided.filter((entry) => entry.won).length / decided.length : null };
  }
}
