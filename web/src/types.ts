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
}

export interface RawEdge {
  playerA: number;
  playerB: number;
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
}

export interface Link {
  source: Player;
  target: Player;
  w: number;
  recency: number;
  dates: string[];
}

export interface ParsedGraph {
  nodes: Player[];
  links: Link[];
  teams: Record<number, RawTeamInfo>;
  maxGlobalDeg: number;
  dateMin: string | null;
  dateMax: string | null;
  winRates: Map<string, number>;
  games: Game[];
  playerTeamDates: Map<number, Map<number, string[]>>;
}

export interface ViewResult {
  nodes: Player[];
  links: Link[];
}

export interface Filters {
  minW: number;
  maxW: number;
  minD: number;
  maxD: number;
  dateStart: string | null;
  dateEnd: string | null;
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
  onSelect: (id: number | null) => void;
  onEdgeSelect: (edge: EdgeSelection | null) => void;
  onStageClick: () => void;
  onNodeHover: (id: string | null) => void;
  onNodeTeamHover: (teamId: number | null) => void;
  onTooltip: (tip: { x: number; y: number; visible: boolean; text: string } | null) => void;
}
