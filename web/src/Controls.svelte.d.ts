export {};

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
		showEdges?: boolean;
		onEdgeAlpha?: (lo: number, hi: number) => void;
		onEdgeColor?: (mode: string) => void;
	}
	export default class Controls extends SvelteComponent<Props> {}
}
