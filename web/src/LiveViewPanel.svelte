<script lang="ts">
	import uPlot from "uplot";
	import "uplot/dist/uPlot.min.css";
	import type { LayoutTickStats } from "./graph/layout";

	let { stats, running }: {
		stats: LayoutTickStats[];
		running: boolean;
	} = $props();

	let chartContainer: HTMLDivElement | null = $state(null);
	let uplotInstance: InstanceType<typeof uPlot> | null = null;
	let rafId: number | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let pointerInside = false;
	const MAX_POINTS = 300;

	function getChartData(): Float64Array[] {
		const n = Math.min(stats.length, MAX_POINTS);
		if (n === 0) return Array.from({ length: 13 }, () => new Float64Array());
		const slice = stats.slice(-n);
		const t0 = slice[0].timestamp;
		const cols = (sel: (s: LayoutTickStats) => number) =>
			new Float64Array(slice.map((s) => Math.max(sel(s), 1e-6)));
		return [
			new Float64Array(slice.map((s) => (s.timestamp - t0) / 1000)),
			cols((s) => s.kineticEnergy),
			cols((s) => s.meanDisplacement),
			cols((s) => s.maxDisplacement),
			cols((s) => s.stdDisplacement),
			cols((s) => s.edgeCrossings ?? 0),
			cols((s) => s.minCrossingAngle ?? 0),
			cols((s) => s.meanCrossingAngle ?? 0),
			cols((s) => s.angularResolution ?? 0),
			cols((s) => s.edgeLengthCV ?? 0),
			cols((s) => s.nodeSpread ?? 0),
			cols((s) => s.aspectRatio ?? 1),
			cols((s) => s.totalEdgeLength ?? 0),
		];
	}

	function createOpts(width: number): uPlot.Options {
		return {
			width,
			height: 200,
			scales: {
				x: { time: false },
				y: { log: 10, min: 1e-6 },
			},
		series: [
			{},
			// @ts-ignore
			{ label: "Kinetic Energy", stroke: "#e03131", width: 1.5, paths: uPlot.paths.linear(), value: legendValue(3) },
			// @ts-ignore
			{ label: "Mean Disp.", stroke: "#1971c2", width: 1, paths: uPlot.paths.linear(), value: legendValue(3), show: false },
			// @ts-ignore
			{ label: "Max Disp.", stroke: "#fa923f", width: 1, paths: uPlot.paths.linear(), value: legendValue(3), show: false },
			// @ts-ignore
			{ label: "Std Disp.", stroke: "#40c057", width: 1, paths: uPlot.paths.linear(), value: legendValue(3), show: false },
			// @ts-ignore
			{ label: "Edge Xings", stroke: "#862e9c", width: 1, paths: uPlot.paths.linear(), value: legendValue(0), show: false },
			// @ts-ignore
			{ label: "Min Cross ∠", stroke: "#e8590c", width: 1, paths: uPlot.paths.linear(), value: legendValue(2), show: false },
			// @ts-ignore
			{ label: "Mean Cross ∠", stroke: "#109868", width: 1, paths: uPlot.paths.linear(), value: legendValue(2), show: false },
			// @ts-ignore
			{ label: "Angular Res", stroke: "#0b7285", width: 1, paths: uPlot.paths.linear(), value: legendValue(2), show: false },
			// @ts-ignore
			{ label: "Edge Len CV", stroke: "#c2255c", width: 1, paths: uPlot.paths.linear(), value: legendValue(3), show: false },
			// @ts-ignore
			{ label: "Node Spread", stroke: "#5c940d", width: 1, paths: uPlot.paths.linear(), value: legendValue(3), show: false },
			// @ts-ignore
			{ label: "Aspect", stroke: "#9c36b5", width: 1, paths: uPlot.paths.linear(), value: legendValue(3), show: false },
			// @ts-ignore
			{ label: "Tot Edge Len", stroke: "#e67700", width: 1, paths: uPlot.paths.linear(), value: legendValue(2), show: false },
		],
			axes: [
				{ scale: "x", show: false },
				{ scale: "y", show: true, stroke: "rgba(128,128,128,0.3)", grid: { stroke: "rgba(128,128,128,0.1)" }, size: 50 },
			],
			cursor: {
				show: true,
				points: { show: true },
				drag: { x: true, y: false },
			},
		};
	}

	// Cursor policy: land on the latest point by default; snap to it on mouse
	// leave; never steal the cursor while the pointer is hovering the plot.
	// uPlot's legend is driven by pixel left/top, so position the cursor at the
	// last point's screen coords (idx alone is ignored for the legend).
	function snapToLatest(plot: uPlot) {
		const n = Math.min(stats.length, MAX_POINTS);
		if (n === 0) return;
		const slice = stats.slice(-n);
		const t0 = slice[0].timestamp;
		const xVal = (slice[n - 1].timestamp - t0) / 1000;
		const yVal = Math.max(slice[n - 1].kineticEnergy, 1e-6);
		const left = plot.valToPos(xVal, "x");
		const top = plot.valToPos(yVal, "y");
		plot.setCursor({ left, top });
	}

	function snapOnLeave(plot: uPlot) {
		plot.over.addEventListener("mouseenter", () => (pointerInside = true));
		plot.over.addEventListener("mouseleave", () => {
			pointerInside = false;
			snapToLatest(plot);
		});
	}

	function destroyChart() {
		if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
		if (uplotInstance) { uplotInstance.destroy(); uplotInstance = null; }
	}

	function createChart(w: number) {
		destroyChart();
		if (!chartContainer) return;
		const opts = createOpts(w);
		uplotInstance = new uPlot(opts, getChartData(), chartContainer);
		snapToLatest(uplotInstance);
		snapOnLeave(uplotInstance);
		const tick = () => {
			if (!uplotInstance) return;
			uplotInstance.setData(getChartData());
			if (!pointerInside) snapToLatest(uplotInstance);
			rafId = requestAnimationFrame(tick);
		};
		rafId = requestAnimationFrame(tick);
	}

	function handleResize(entries: ResizeObserverEntry[]) {
		const w = entries[0]?.contentRect.width ?? 800;
		if (w > 0) createChart(w);
	}

	$effect(() => {
		const c = chartContainer;
		if (!c) return;
		resizeObserver = new ResizeObserver(handleResize);
		resizeObserver.observe(c);
		return () => {
			resizeObserver?.disconnect();
			resizeObserver = null;
			destroyChart();
		};
	});

	function formatNum(n: number, width = 9, dec = 3): string {
		if (!isFinite(n)) return "NaN".padStart(width);
		let s = n.toFixed(dec);
		if (s.length > width) s = n.toExponential(2);
		if (s.length > width) s = s.slice(0, width);
		return s.padStart(width);
	}

	function legendValue(dec: number) {
		return (_u: uPlot, rawValue: number, _seriesIdx: number, _idx: number | null) =>
			formatNum(rawValue ?? 0, 9, dec);
	}
</script>

<div class="flex flex-col gap-3">
	{#if !running && stats.length === 0}
		<div class="flex items-center justify-center h-48 text-base-content/40">
			<p class="text-sm">Start a layout to see live metrics. Adjust parameters in the sidebar.</p>
		</div>
	{:else}
		<!-- Chart -->
		<div>
			<div class="flex items-center justify-between mb-2">
				<h3 class="text-xs font-semibold">Layout Metrics</h3>
				{#if running}
					<span class="badge badge-primary badge-xs gap-1">
						<span class="loading loading-dots loading-xs"></span>
						Live
					</span>
				{:else}
					<span class="badge badge-ghost badge-xs">Stopped</span>
				{/if}
			</div>
			<div bind:this={chartContainer} class="w-full"></div>
			<div class="flex flex-wrap gap-3 mt-2 text-[10px]">
				<span class="flex items-center gap-1"><span class="w-2 h-0.5 bg-[#e03131] inline-block"></span> Kinetic</span>
				<span class="flex items-center gap-1"><span class="w-2 h-0.5 bg-[#1971c2] inline-block"></span> Mean Δ</span>
				<span class="flex items-center gap-1"><span class="w-2 h-0.5 bg-[#fa923f] inline-block"></span> Max Δ</span>
				<span class="flex items-center gap-1"><span class="w-2 h-0.5 bg-[#40c057] inline-block"></span> Std Δ</span>
				<span class="flex items-center gap-1"><span class="w-2 h-0.5 bg-[#862e9c] inline-block"></span> Edge Xings</span>
				<span class="flex items-center gap-1"><span class="w-2 h-0.5 bg-[#e8590c] inline-block"></span> Min Cross ∠</span>
				<span class="flex items-center gap-1"><span class="w-2 h-0.5 bg-[#109868] inline-block"></span> Mean Cross ∠</span>
				<span class="flex items-center gap-1"><span class="w-2 h-0.5 bg-[#0b7285] inline-block"></span> Angular Res</span>
				<span class="flex items-center gap-1"><span class="w-2 h-0.5 bg-[#c2255c] inline-block"></span> Edge Len CV</span>
				<span class="flex items-center gap-1"><span class="w-2 h-0.5 bg-[#5c940d] inline-block"></span> Node Spread</span>
				<span class="flex items-center gap-1"><span class="w-2 h-0.5 bg-[#9c36b5] inline-block"></span> Aspect</span>
				<span class="flex items-center gap-1"><span class="w-2 h-0.5 bg-[#e67700] inline-block"></span> Tot Edge Len</span>
			</div>
		</div>
	{/if}
</div>

<style>
	:global(.u-legend .u-value) {
		font-family: ui-monospace, "SFMono-Regular", "Menlo", monospace;
		white-space: pre;
		text-align: right;
		min-width: 9ch;
		display: inline-block;
	}
</style>
