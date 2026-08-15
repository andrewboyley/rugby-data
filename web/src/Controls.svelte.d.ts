export {};

declare module "./Controls.svelte" {
	import type { SvelteComponent } from "svelte";
	interface Props {
		minW?: number;
		maxW?: number;
		minD?: number;
		maxD?: number;
		team?: number | null;
		dateStart?: string | null;
		dateEnd?: string | null;
		teams?: Record<number, { name?: string }>;
		maxDeg?: number;
		maxWCap?: number;
		dateMin?: string | null;
		dateMax?: string | null;
		edgeColor?: string;
		alphaMin?: number;
		alphaMax?: number;
		nodeColor?: string;
		onTeamZoom?: (tid: number | null) => void;
		onEdgeAlpha?: (lo: number, hi: number) => void;
		onEdgeColor?: (mode: string) => void;
	}
	export default class Controls extends SvelteComponent<Props> {}
}
