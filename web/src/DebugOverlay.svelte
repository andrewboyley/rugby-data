<script lang="ts">
	import { onDestroy } from "svelte";
	import uPlot from "uplot";
	import "uplot/dist/uPlot.min.css";

	import type { LayoutTickStats } from "./graph/layout.ts";

	interface Props {
		visible: boolean;
		stats: LayoutTickStats[];
	}

	let { visible, stats }: Props = $props();

	let container: HTMLElement | null = $state(null);
	let uplotInstance: InstanceType<typeof uPlot> | null = null;
	let rafId: number | null = null;
	const MAX_POINTS = 300;

	const series: uPlot.Series[] = [
		{},
		// @ts-ignore
		{ label: "Kinetic Energy", stroke: "#e03131", width: 1.5, paths: uPlot.paths.linear() },
		// @ts-ignore
		{ label: "Mean Displacement", stroke: "#1971c2", width: 1, paths: uPlot.paths.linear() },
		// @ts-ignore
		{ label: "Max Displacement", stroke: "#fa923f", width: 1, paths: uPlot.paths.linear() },
		// @ts-ignore
		{ label: "Std Displacement", stroke: "#40c057", width: 1, paths: uPlot.paths.linear() },
	];

	const opts: uPlot.Options = {
		width: 380,
		height: 180,
		scales: {
			x: { time: false },
			y: { log: 10, min: 1e-6 },
		},
		series,
		axes: [
			{ scale: "x", show: false },
			{ scale: "y", show: true, stroke: "rgba(0,0,0,0.2)", grid: { stroke: "rgba(0,0,0,0.1)" }, size: 40 },
		],
		cursor: {
			show: true,
			points: { show: true },
			drag: { x: true, y: false },
		},
	};

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

	function updateChart() {
		if (!uplotInstance) return;
		const data = getChartData();
		uplotInstance.setData(data);
	}

	function renderLoop() {
		updateChart();
		rafId = requestAnimationFrame(renderLoop);
	}

	$effect(() => {
		if (!container || !visible) return;
		if (!uplotInstance) {
			uplotInstance = new uPlot(opts, getChartData(), container);
			renderLoop();
		}
	});

	$effect(() => {
		if (uplotInstance && visible) {
			updateChart();
		}
	});

	onDestroy(() => {
		if (rafId) cancelAnimationFrame(rafId);
		if (uplotInstance) {
			uplotInstance.destroy();
			uplotInstance = null;
		}
	});

	function formatNum(n: number): string {
		return n >= 1e4 || (n < 1e-3 && n > 0) ? n.toExponential(2) : n.toFixed(4);
	}
</script>

{#if visible}
<div class="debug-overlay" bind:this={container}>
	<div class="overlay-header">
		<span class="overlay-title">Layout Debug</span>
		<button class="btn btn-ghost btn-xs" onclick={() => (visible = false)}>✕</button>
	</div>

	<div class="chart-container" bind:this={container}></div>

	<div class="stats-grid">
		{#if stats.length > 0}
		<div class="stat-row">
			<span class="stat-label">Kinetic Energy</span>
			<span class="stat-value">{formatNum(stats[stats.length - 1].kineticEnergy)}</span>
		</div>
		<div class="stat-row">
			<span class="stat-label">Mean Δ</span>
			<span class="stat-value">{formatNum(stats[stats.length - 1].meanDisplacement)}</span>
		</div>
		<div class="stat-row">
			<span class="stat-label">Max Δ</span>
			<span class="stat-value">{formatNum(stats[stats.length - 1].maxDisplacement)}</span>
		</div>
		<div class="stat-row">
			<span class="stat-label">Std Δ</span>
			<span class="stat-value">{formatNum(stats[stats.length - 1].stdDisplacement)}</span>
		</div>
		<div class="stat-row">
			<span class="stat-label">Nodes</span>
			<span class="stat-value">{stats[stats.length - 1].nodeCount}</span>
		</div>
		{:else}
		<div class="stat-row"><span class="stat-label">Waiting for layout...</span></div>
		{/if}
	</div>
</div>
{/if}

<style>
	.debug-overlay {
		position: fixed;
		top: 140px;
		right: 16px;
		z-index: 1000;
		background: var(--b2);
		border: 1px solid var(--b3);
		border-radius: 8px;
		padding: 12px;
		min-width: 400px;
		max-width: 420px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 12px;
	}

	.overlay-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
		padding-bottom: 6px;
		border-bottom: 1px solid var(--b3);
	}

	.overlay-title {
		font-weight: 600;
		font-size: 13px;
		color: var(--bc);
	}

	.chart-container {
		width: 380px;
		height: 180px;
		margin-bottom: 10px;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px 12px;
	}

	.stat-row {
		display: flex;
		justify-content: space-between;
		padding: 2px 0;
	}

	.stat-label {
		color: var(--bc);
		opacity: 0.7;
	}

	.stat-value {
		font-weight: 600;
		color: var(--bc);
		text-align: right;
		min-width: 80px;
	}
</style>