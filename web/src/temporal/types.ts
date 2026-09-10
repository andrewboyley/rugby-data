export type NodeId = string;
export type PairKey = string;

export type Match = Readonly<{
  eventId: number;
  timestamp: number;
  teamId: number;
  coachId: NodeId | null;
  won: boolean | null;
  players: readonly NodeId[];
}>;

export type EdgeDelta = Readonly<{ source: NodeId; target: NodeId; count: number; latest?: number; winRate?: number | null }>;

export type Delta = {
  addNodes: NodeId[];
  removeNodes: NodeId[];
  addEdges: EdgeDelta[];
  updateEdges: EdgeDelta[];
  removeEdges: Array<Pick<EdgeDelta, "source" | "target">>;
};

export type DatasetLike = {
  games?: Array<{
    eventId: number;
    date: string | null;
    competitors?: Array<{
      teamId: number;
      score?: number | null;
      coachId?: string | number | null;
        roster?: Array<{ playerId: string | number; jersey?: number | null }>;
      home?: boolean;
    }>;
  }>;
  players?: Record<string, string>;
  coaches?: Record<string, string>;
  teams?: Record<string, string | { name?: string }>;
};

export const pairKey = (a: NodeId, b: NodeId): PairKey => a < b ? `${a},${b}` : `${b},${a}`;
export const pairNodes = (key: PairKey): [NodeId, NodeId] => key.split(",") as [NodeId, NodeId];
export const emptyDelta = (): Delta => ({ addNodes: [], removeNodes: [], addEdges: [], updateEdges: [], removeEdges: [] });
