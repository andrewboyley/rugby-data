<script lang="ts">
	import uPlot from "uplot";
	import "uplot/dist/uPlot.min.css";

	export type PlotSeries = {
		label: string;
		data: number[];
		color: string;
		dash?: number[];
		width?: number;
		fill?: string;
	};

	let { series = [] }: { series?: PlotSeries[] } = $props();

	let container: HTMLDivElement | null = $state(null);
	let u: uPlot | null = null;
	let ro: ResizeObserver | null = null;
	let pointerInside = false;

	// Cursor policy: land on the latest point by default; snap to it on mouse
	// leave; never steal the cursor while the pointer is hovering the plot.
	// uPlot's legend is driven by pixel left/top, so position the cursor at the
	// last point's screen coords (idx alone is ignored for the legend).
	function snapToLatest(plot: uPlot) {
		const n = series.reduce((m, s) => Math.max(m, s.data.length), 0);
		if (n === 0) return;
		const left = plot.valToPos(n - 1, "x");
		const yv = series[0]?.data[n - 1] ?? 0;
		const top = plot.valToPos(yv, "y");
		plot.setCursor({ left, top, idx: n - 1 });
	}

	function snapOnLeave(plot: uPlot) {
		plot.over.addEventListener("mouseenter", () => (pointerInside = true));
		plot.over.addEventListener("mouseleave", () => {
			pointerInside = false;
			snapToLatest(plot);
		});
	}

	function chartData(): Float64Array[] {
		if (series.length === 0) return [new Float64Array()];
		const n = series.reduce((m, s) => Math.max(m, s.data.length), 0);
		if (n === 0) return [new Float64Array(), ...series.map(() => new Float64Array())];
		const out: Float64Array[] = [new Float64Array(n)];
		for (let i = 0; i < n; i++) out[0][i] = i;
		for (const s of series) {
			const y = new Float64Array(n);
			for (let i = 0; i < n; i++) y[i] = i < s.data.length ? s.data[i] : NaN;
			out.push(y);
		}
		return out;
	}

	function buildOpts(w: number): uPlot.Options {
		return {
			width: w,
			height: 200,
			scales: { x: { time: false }, y: {} },
			series: [
				{},
				...series.map((s) => ({
					label: s.label,
					stroke: s.color,
					width: s.width ?? 1.5,
					dash: s.dash,
					fill: s.fill,
					value: (_u: uPlot, v: number | null) => (v == null ? "" : v.toFixed(3)),
				})),
			],
			axes: [
				{
					stroke: "rgba(128,128,128,0.5)",
					grid: { stroke: "rgba(128,128,128,0.12)" },
					size: 38,
					values: (_u: uPlot, splits: number[]) => splits.map((s) => s.toFixed(0)),
				},
				{
					stroke: "rgba(128,128,128,0.5)",
					grid: { stroke: "rgba(128,128,128,0.12)" },
					size: 44,
					values: (_u: uPlot, splits: number[]) => splits.map((s) => s.toFixed(3)),
				},
			],
			cursor: {
				show: true,
				points: { show: false },
				focus: { prox: 100 },
			},
		};
	}

	// Create the chart once; on `series` changes just push new data (rebuild only
	// if the number of series changed). No rAF loop and no recreate-on-resize —
	// those caused the plot to flash.
	$effect(() => {
		void series;
		if (!container) return;
		const w = Math.max(1, container.clientWidth || 400);
		if (!u) {
			u = new uPlot(buildOpts(w), chartData(), container);
			// Land the cursor on the latest point by default (legend shows latest)
			snapToLatest(u);
			snapOnLeave(u);
			return;
		}
		if (u.series.length - 1 !== series.length) {
			u.destroy();
			u = new uPlot(buildOpts(w), chartData(), container);
			if (!pointerInside) snapToLatest(u);
			snapOnLeave(u);
		} else {
			u.setData(chartData());
			if (!pointerInside) snapToLatest(u);
		}
	});

	$effect(() => {
		const c = container;
		if (!c) return;
		ro = new ResizeObserver(() => {
			if (u && c.clientWidth > 0) u.setSize({ width: c.clientWidth, height: 200 });
		});
		ro.observe(c);
		return () => {
			ro?.disconnect();
			ro = null;
		};
	});

	$effect(() => {
		return () => {
			u?.destroy();
			u = null;
		};
	});
</script>

<div bind:this={container} class="w-full"></div>
