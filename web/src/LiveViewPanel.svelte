<script lang="ts">
	import uPlot from "uplot";
	import "uplot/dist/uPlot.min.css";
	import type { LayoutTickStats } from "./graph/layout";

	let { stats, running, quality, onStartStop, onReset }: {
		stats: LayoutTickStats[];
		running: boolean;
		quality: number;
		onStartStop: () => void;
		onReset: () => void;
	} = $props();

	let chartContainer: HTMLDivElement | null = $state(null);
	let uplotInstance: InstanceType<typeof uPlot> | null = null;
	let rafId: number | null = null;
	let resizeObserver: ResizeObserver | null = null;
	const MAX_POINTS = 300;

	function getChartData(): Float64Array[] {
		const n = Math.min(stats.length, MAX_POINTS);
		if (n === 0) return [new Float64Array(), new Float64Array(), new Float64Array(), new Float64Array(), new Float64Array()];
		const slice = stats.slice(-n);
		const t0 = slice[0].timestamp;
		return [
			new Float64Array(slice.map((s) => (s.timestamp - t0) / 1000)),
			new Float64Array(slice.map((s) => Math.max(s.kineticEnergy, 1e-6))),
			new Float64Array(slice.map((s) => s.meanDisplacement)),
			new Float64Array(slice.map((s) => s.maxDisplacement)),
			new Float64Array(slice.map((s) => s.stdDisplacement)),
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
				{ label: "Kinetic Energy", stroke: "#e03131", width: 1.5, paths: uPlot.paths.linear() },
				// @ts-ignore
				{ label: "Mean Displacement", stroke: "#1971c2", width: 1, paths: uPlot.paths.linear() },
				// @ts-ignore
				{ label: "Max Displacement", stroke: "#fa923f", width: 1, paths: uPlot.paths.linear() },
				// @ts-ignore
				{ label: "Std Displacement", stroke: "#40c057", width: 1, paths: uPlot.paths.linear() },
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

	function destroyChart() {
		if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
		if (uplotInstance) { uplotInstance.destroy(); uplotInstance = null; }
	}

	function createChart(w: number) {
		destroyChart();
		if (!chartContainer) return;
		const opts = createOpts(w);
		uplotInstance = new uPlot(opts, getChartData(), chartContainer);
		const tick = () => {
			if (!uplotInstance) return;
			uplotInstance.setData(getChartData());
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

	function formatNum(n: number): string {
		return n >= 1e4 || (n < 1e-3 && n > 0) ? n.toExponential(2) : n.toFixed(4);
	}
</script>

<div class="flex flex-col gap-3">
	<!-- Layout controls -->
	<div class="flex items-center gap-2 mb-2">
		<button
			class="btn btn-xs {running ? 'btn-error' : 'btn-primary'}"
			onclick={onStartStop}
		>
			{running ? "Stop" : "Start"} Layout
		</button>
		<button class="btn btn-xs btn-ghost" onclick={onReset}>Reset</button>
	</div>

	{#if !running && stats.length === 0}
		<div class="flex items-center justify-center h-48 text-base-content/40">
			<p class="text-sm">Start a layout to see live metrics. Adjust parameters in the sidebar above.</p>
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
			</div>
		</div>

		<!-- Stats grid -->
		{#if stats.length > 0}
			{@const latest = stats[stats.length - 1]}
			<div class="grid grid-cols-3 gap-2">
				<div class="stat bg-base-100 border border-base-300 rounded p-2">
					<div class="stat-title text-[10px]">Quality (Q)</div>
					<div class="stat-value text-sm font-mono">{quality.toFixed(4)}</div>
				</div>
				<div class="stat bg-base-100 border border-base-300 rounded p-2">
					<div class="stat-title text-[10px]">Kinetic Energy</div>
					<div class="stat-value text-sm font-mono">{formatNum(latest.kineticEnergy)}</div>
				</div>
				<div class="stat bg-base-100 border border-base-300 rounded p-2">
					<div class="stat-title text-[10px]">Mean Disp.</div>
					<div class="stat-value text-sm font-mono">{formatNum(latest.meanDisplacement)}</div>
				</div>
				<div class="stat bg-base-100 border border-base-300 rounded p-2">
					<div class="stat-title text-[10px]">Max Disp.</div>
					<div class="stat-value text-sm font-mono">{formatNum(latest.maxDisplacement)}</div>
				</div>
				<div class="stat bg-base-100 border border-base-300 rounded p-2">
					<div class="stat-title text-[10px]">Std Disp.</div>
					<div class="stat-value text-sm font-mono">{formatNum(latest.stdDisplacement)}</div>
				</div>
				<div class="stat bg-base-100 border border-base-300 rounded p-2">
					<div class="stat-title text-[10px]">Settled</div>
					<div class="stat-value text-sm font-mono">{(latest.settledProgress * 100).toFixed(0)}%</div>
				</div>
				<div class="stat bg-base-100 border border-base-300 rounded p-2">
					<div class="stat-title text-[10px]">Nodes</div>
					<div class="stat-value text-sm font-mono">{latest.nodeCount}</div>
				</div>
			</div>
		{/if}
	{/if}
</div>
