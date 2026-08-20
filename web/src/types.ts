// Shared domain types for the rugby graph viewer.

export interface RawGraphData {
  players: Record<number, string>;
  appearances: Record<number, number>;
  playerTeams: Record<number, number | number[]>;
  playerTeamDates: Record<number, Record<number, string[]>>;
  playerJersey: Record<number, number>;
  playerDates: Record<number, string[]>;
  edges: RawEdge[];
  teams: RawTeamMap;
  dateMin: string | null;
  dateMax: string | null;
  winRates: Record<string, number>;
  games: Game[];
  coachAppearances: Record<string, number>;
  coachDates: Record<string, string[]>;
  coachTeams: Record<string, number[]>;
  coachTeamDates: Record<string, Record<number, string[]>>;
  coachEdges: RawCoachEdge[];
  coaches: Record<string, string>;
}

export interface RawEdge {
  playerA: number;
  playerB: number;
  weight: number;
  recency?: number;
  dates?: string[];
}

export interface RawCoachEdge {
  coachA: string;
  coachB: string;
  weight: number;
  recency?: number;
  dates?: string[];
}

export interface RawTeamMap {
  [id: string]: RawTeamInfo;
}

export interface RawTeamInfo {
  name: string;
  color: string;
  alternateColor?: string;
  abbreviation?: string;
}

export interface RosterEntry {
  playerId: number;
  jersey: number;
}

export interface Competitor {
  teamId: number;
  home: boolean;
  score: number | null;
  roster: RosterEntry[];
  coach: string | null;
  /** Normalised coach node id (null when the game has no coach). */
  coachNodeId?: number | null;
}

export interface Game {
  eventId: number;
  date: string | null;
  competitors: Competitor[];
  venue: { name: string | null; city: string | null; country: string | null } | null;
  league: { name: string; abbreviation: string | null } | null;
}

export interface Player {
  id: number;
  name: string;
  team: number | null;
  teams: number[];
  jersey: number | null;
  app: number;
  dates: string[];
  deg: number;
  globalDeg: number;
  x?: number;
  y?: number;
  isCoach?: false;
  coachTwin?: boolean;
}

export interface Coach {
  id: number;
  name: string;
  team: number | null;
  teams: number[];
  app: number;
  dates: string[];
  deg: number;
  globalDeg: number;
  x?: number;
  y?: number;
  isCoach: true;
}

export type GraphNode = Player | Coach;

export interface Link {
  source: GraphNode;
  target: GraphNode;
  w: number;
  recency: number;
  dates: string[];
  /** True when the edge came from coach co-occurrence (coach-coach or coach-player). */
  coach?: boolean;
}

// Serializable version for worker transfer (source/target are node IDs)
export interface SerializableLink {
  source: number;
  target: number;
  w: number;
  recency: number;
  dates: string[];
  coach?: boolean;
}

export interface ParsedGraph {
  nodes: Player[];
  coachNodes: Coach[];
  links: Link[];
  teams: Record<number, RawTeamInfo>;
  maxGlobalDeg: number;
  dateMin: string | null;
  dateMax: string | null;
  winRates: Map<string, number>;
  games: Game[];
  playerTeamDates: Map<number, Map<number, string[]>>;
  coachTeamDates: Map<number, Map<number, string[]>>;
}

// Serializable version for worker transfer (Maps -> plain objects)
export interface ParsedGraphData {
  nodes: Player[];
  coachNodes: Coach[];
  links: SerializableLink[];
  teams: Record<number, RawTeamInfo>;
  maxGlobalDeg: number;
  dateMin: string | null;
  dateMax: string | null;
  winRates: Record<number, number>;
  games: Game[];
  playerTeamDates: Record<number, Record<number, string[]>>;
  coachTeamDates: Record<number, Record<number, string[]>>;
  playerJersey: Record<number, number>;
  playerDates: Record<number, string[]>;
  appearances: Record<number, number>;
  playerTeams: Record<number, number[]>;
  coachDates: Record<string, string[]>;
  coachTeams: Record<string, number[]>;
  coachNames: Record<string, string>;
  coachAppearances: Record<string, number>;
}

export interface ViewResult {
  nodes: GraphNode[];
  links: Link[];
}

export interface Filters {
  minW: number;
  minD: number;
  dateStart: string | null;
  dateEnd: string | null;
  showCoaches: boolean;
}

export interface PlayerMatch {
  date: string;
  g: Game;
  myTeamId: number;
  oppId: number | null;
  home: boolean;
  my: number | null;
  opp: number | null;
  winner: number | null;
}

export interface EdgeSelection {
  key: string;
  a: string;
  b: string;
  source: string;
  target: string;
  team: number | null;
  w: number;
  dates: string[];
}

export interface LayoutStatePayload {
  running: boolean;
  first: boolean;
  nodes: number;
  edges: number;
}

export interface GraphControllerCallbacks {
  onLayoutState: (state: LayoutStatePayload) => void;
  onGraphReady: () => void;
  onSelect: (id: number | null) => void;
  onSelectSecondary: (id: number | null) => void;
  onEdgeSelect: (edge: EdgeSelection | null) => void;
  onStageClick: () => void;
  onNodeHover: (id: string | null) => void;
  onNodeTeamHover: (teamId: number | null) => void;
  onTooltip: (tip: { x: number; y: number; visible: boolean; text: string } | null) => void;
}
