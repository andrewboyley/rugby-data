declare module "./Controls.svelte" {
  import type { SvelteComponent } from "svelte";
  interface Props {
    minW?: number;
    minD?: number;
    maxWeight?: number;
    maxDeg?: number;
    edgeColor?: string;
    alphaMin?: number;
    alphaMax?: number;
    nodeColor?: string;
    showCoaches?: boolean;
    showMetaballs?: boolean;
    onEdgeAlpha?: (lo: number, hi: number) => void;
    onEdgeColor?: (mode: string) => void;
  }
  export default class Controls extends SvelteComponent<Props> {}
}

declare module "./Hud.svelte" {
  import type { SvelteComponent } from "svelte";
  import type { Player, PlayerMatch } from "./types.js";
  interface Props {
    node: Player | null | undefined;
    deg: number;
    partners: { source: { id: number; name: string }; target: { id: number; name: string }; w: number }[];
    teams: Record<number, { name: string; color?: string }>;
    onClear: () => void;
    onPartnerHover: (id: number | null) => void;
    onPartnerClick: (l: { source: { id: number }; target: { id: number } }) => void;
    hoveredTeammate: number | null;
    onTeamZoom: (tid: number) => void;
    playerMatches: PlayerMatch[];
    onMatchClick: (game: any) => void;
    activeMatch: number | null;
  }
  export default class Hud extends SvelteComponent<Props> {}
}



declare module "./MatchHud.svelte" {
  import type { SvelteComponent } from "svelte";
  import type { Game } from "./types.js";
  interface Props {
    match: { eventId: number; date: string | null; competitors: any[] } | null;
    teams: Record<number, { name: string; color?: string }>;
    playerName: (id: number) => string;
    teamColor: (tid: number | null | undefined) => string;
    onClose: () => void;
    onPick: (id: number) => void;
  }
  export default class MatchHud extends SvelteComponent<Props> {}
}
