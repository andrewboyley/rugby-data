<script lang="ts">
	import { onDestroy } from "svelte";
	import type { Game } from "./types.ts";

	let {
		graphGames,
		dateStart = $bindable<string | null>(),
		dateEnd = $bindable<string | null>(null),
		activeMatch = $bindable<Game | null>(null),
		showTimeline = $bindable(false),
	}: {
		graphGames: Game[];
		dateStart: string | null;
		dateEnd: string | null;
		activeMatch: Game | null;
		showTimeline: boolean;
	} = $props();

	let playing = $state(false);
	let playSpeed = $state(1);
	let playTimer: ReturnType<typeof setInterval> | null = null;
	let userDragging = $state(false);
	let dragHandle = $state<'start' | 'end' | null>(null);
	let dragPreviewIdx = $state<number | null>(null);
	let sliderRef = $state<HTMLDivElement | null>(null);
	let hoverIdx = $state<number | null>(null);

	const ALL_MATCH_DATES = $derived.by(() => {
		const dates = [...new Set(
			(graphGames ?? [])
				.filter((g) => g.date)
				.map((g) => g.date!)
				.sort()
		)];
		return dates;
	});

	// Collapse the timeline when clicking anywhere outside it.
	let wrapEl = $state<HTMLDivElement>();
	$effect(() => {
		if (!showTimeline) return;
		const onDoc = (e: MouseEvent) => {
			if (wrapEl && !wrapEl.contains(e.target as Node)) showTimeline = false;
		};
		document.addEventListener("click", onDoc);
		return () => document.removeEventListener("click", onDoc);
	});

	const totalSteps = $derived(ALL_MATCH_DATES.length);

	const userStartIdx = $derived(dateStart ? findStartIdx(dateStart) : 0);
	const userEndIdx = $derived(dateEnd ? findEndIdx(dateEnd) : totalSteps - 1);

	function findStartIdx(target: string): number {
		// Find the first match date >= target
		for (let i = 0; i < ALL_MATCH_DATES.length; i++) {
			if (ALL_MATCH_DATES[i] >= target) return i;
		}
		return ALL_MATCH_DATES.length - 1;
	}

	function findEndIdx(target: string): number {
		// Find the last match date <= target
		for (let i = ALL_MATCH_DATES.length - 1; i >= 0; i--) {
			if (ALL_MATCH_DATES[i] <= target) return i;
		}
		return 0;
	}
	const windowSize = $derived(Math.max(1, userEndIdx - userStartIdx));

	let playStartIdx = $state(0);
	let playEndIdx = $derived(playStartIdx + windowSize);

	const userStartPct = $derived(totalSteps > 0 ? (userStartIdx / (totalSteps - 1)) * 100 : 0);
	const userEndPct = $derived(totalSteps > 0 ? (userEndIdx / (totalSteps - 1)) * 100 : 0);
	const dragStartPct = $derived(dragHandle === 'start' && dragPreviewIdx !== null && totalSteps > 0 ? (dragPreviewIdx / (totalSteps - 1)) * 100 : userStartPct);
	const dragEndPct = $derived(dragHandle === 'end' && dragPreviewIdx !== null && totalSteps > 0 ? (dragPreviewIdx / (totalSteps - 1)) * 100 : userEndPct);
	const windowWidthPct = $derived(totalSteps > 0 ? (windowSize / (totalSteps - 1)) * 100 : 0);
	const playWindowStartPct = $derived(totalSteps > 0 ? (playStartIdx / (totalSteps - 1)) * 100 : 0);

	const currentPlayDate = $derived(ALL_MATCH_DATES[playStartIdx] ?? "");
	const currentPlayDateEnd = $derived(ALL_MATCH_DATES[playEndIdx] ?? "");

	const yearBuckets = $derived.by(() => {
		const buckets: Record<number, number> = {};
		for (const g of graphGames ?? []) {
			if (!g.date) continue;
			const y = parseInt(g.date.slice(0, 4));
			if (!isNaN(y)) buckets[y] = (buckets[y] || 0) + 1;
		}
		const years = Object.keys(buckets).map(Number).sort((a, b) => a - b);
		return { buckets, years };
	});

	// Year positions aligned with slider (percentage along the date range)
	const yearPositions = $derived.by(() => {
		if (!yearBuckets.years.length || totalSteps < 2) return {};
		const positions: Record<number, { left: number; width: number }> = {};
		const firstDate = new Date(ALL_MATCH_DATES[0]);
		const lastDate = new Date(ALL_MATCH_DATES[totalSteps - 1]);
		const totalMs = lastDate.getTime() - firstDate.getTime();

		for (const year of yearBuckets.years) {
			const yearStart = new Date(`${year}-01-01`);
			const yearEnd = new Date(`${year + 1}-01-01`);
			const startMs = Math.max(0, yearStart.getTime() - firstDate.getTime());
			const endMs = Math.min(totalMs, yearEnd.getTime() - firstDate.getTime());
			const left = (startMs / totalMs) * 100;
			const width = ((endMs - startMs) / totalMs) * 100;
			if (width > 0) {
				positions[year] = { left, width };
			}
		}
		return positions;
	});

	function stopPlay() {
		if (playTimer) {
			clearInterval(playTimer);
			playTimer = null;
		}
		playing = false;
	}

	onDestroy(() => stopPlay());

	function filterToYear(year: number | null) {
		if (year === null) {
			dateStart = null;
			dateEnd = null;
		} else {
			dateStart = `${year}-01-01`;
			dateEnd = `${year}-12-31`;
		}
		stopPlay();
	}

	function startPlay() {
		if (playing || totalSteps === 0) return;
		playStartIdx = 0;
		playing = true;

		const stepDelay = 200 / playSpeed;

		playTimer = setInterval(() => {
			playStartIdx++;

			if (playStartIdx >= userStartIdx) {
				playStartIdx = userStartIdx;
				stopPlay();
				return;
			}

			applyPlaybackFilter();
		}, stepDelay);
	}

	function togglePlay() {
		if (playing) {
			stopPlay();
			return;
		}
		startPlay();
	}

	function applyPlaybackFilter() {
		if (playStartIdx < ALL_MATCH_DATES.length && playEndIdx < ALL_MATCH_DATES.length) {
			dateStart = ALL_MATCH_DATES[playStartIdx];
			dateEnd = ALL_MATCH_DATES[playEndIdx];
		}
	}

	function onUserStartChange(idx: number) {
		if (idx >= userEndIdx) idx = userEndIdx - 1;
		if (idx < 0) idx = 0;
		dateStart = ALL_MATCH_DATES[idx];
		if (playing) stopPlay();
	}

	function onUserEndChange(idx: number) {
		if (idx <= userStartIdx) idx = userStartIdx + 1;
		if (idx >= totalSteps) idx = totalSteps - 1;
		dateEnd = ALL_MATCH_DATES[idx];
		if (playing) stopPlay();
	}

	function startDrag(handle: 'start' | 'end', event: MouseEvent | TouchEvent) {
		dragHandle = handle;
		userDragging = true;
		if (event instanceof TouchEvent) {
			dragPreviewIdx = Math.round(((event.touches[0].clientX - sliderRef!.getBoundingClientRect().left) / sliderRef!.getBoundingClientRect().width) * (totalSteps - 1));
		} else {
			dragPreviewIdx = Math.round(((event.clientX - sliderRef!.getBoundingClientRect().left) / sliderRef!.getBoundingClientRect().width) * (totalSteps - 1));
		}
		event.stopPropagation();
	}

	function onDragMove(event: MouseEvent | TouchEvent) {
		if (!userDragging || !sliderRef || dragHandle === null) return;
		const rect = sliderRef.getBoundingClientRect();
		let clientX: number;
		if (event instanceof TouchEvent) {
			clientX = event.touches[0].clientX;
		} else {
			clientX = event.clientX;
		}
		const pct = (clientX - rect.left) / rect.width;
		let idx = Math.round(pct * (totalSteps - 1));
		if (dragHandle === 'start') {
			idx = Math.min(idx, userEndIdx - 1);
		} else if (dragHandle === 'end') {
			idx = Math.max(idx, userStartIdx + 1);
		}
		if (idx < 0) idx = 0;
		if (idx >= totalSteps) idx = totalSteps - 1;
		dragPreviewIdx = idx;
	}

	function onDragEnd() {
		if (dragHandle === 'start' && dragPreviewIdx !== null) {
			onUserStartChange(dragPreviewIdx);
		} else if (dragHandle === 'end' && dragPreviewIdx !== null) {
			onUserEndChange(dragPreviewIdx);
		}
		dragHandle = null;
		dragPreviewIdx = null;
		userDragging = false;
	}

	function onTrackClick(event: MouseEvent | TouchEvent) {
		if (userDragging || !sliderRef) return;
		const rect = sliderRef.getBoundingClientRect();
		let clientX: number;
		if (event instanceof TouchEvent) {
			clientX = event.touches[0].clientX;
		} else {
			clientX = event.clientX;
		}
		const pct = (clientX - rect.left) / rect.width;
		const idx = Math.round(pct * (totalSteps - 1));
		if (idx < 0) return;
		if (idx < userStartIdx) {
			onUserStartChange(idx);
		} else if (idx > userEndIdx) {
			onUserEndChange(idx);
		}
	}

	function formatDate(d: string) {
		return d ? d.slice(0, 10) : "—";
	}
</script>

<div class="timeline-wrap" bind:this={wrapEl}>
	<div
		class="timeline-header"
		role="button"
		tabindex="0"
		onclick={() => (showTimeline = !showTimeline)}
		onkeydown={(e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				showTimeline = !showTimeline;
			}
		}}
	>
		<span class="timeline-title">Timeline</span>
		<button
			class="timeline-toggle"
			aria-label={showTimeline ? "Hide timeline" : "Show timeline"}
			onclick={(e) => e.stopPropagation()}
		>
			{showTimeline ? "▼" : "▶"}
		</button>
	</div>

	{#if showTimeline}
		<div class="timeline-content">
			<!-- Year histogram -->
			<div class="histogram">
				{#if yearBuckets.years.length}
					{@const maxCount = Math.max(...Object.values(yearBuckets.buckets))}
					{#each yearBuckets.years as year}
						{@const count = yearBuckets.buckets[year] ?? 0}
						{@const pct = (count / maxCount) * 100}
						{@const isSelected = dateStart && dateEnd && parseInt(dateStart.slice(0,4)) <= year && parseInt(dateEnd.slice(0,4)) >= year}
						{@const pos = yearPositions[year]}
						{#if pos}
							<button
								class="histogram-bar {isSelected ? 'active' : ''}"
								style={`left: ${pos.left}%; width: ${pos.width}%; height: ${Math.max(20, pct)}%`}
								title={`${year}: ${count} matches`}
								onclick={() => filterToYear(isSelected && dateStart === `${year}-01-01` ? null : year)}
							>
								<span class="bar-count">{count}</span>
							</button>
						{/if}
					{/each}
					<div class="histogram-axis">
						{#if yearBuckets.years.length}
							{yearBuckets.years[0]}
							{#if yearBuckets.years.length > 1}
								<span>...</span>
								{yearBuckets.years.at(-1)}
							{/if}
						{/if}
					</div>
				{/if}
			</div>

			<!-- Slider track -->
			<div class="slider-wrap" bind:this={sliderRef}>
				<div class="slider-track" 
					onclick={onTrackClick}
					onmousemove={(e) => { if (!userDragging && sliderRef) { const rect = sliderRef.getBoundingClientRect(); const pct = (e.clientX - rect.left) / rect.width; hoverIdx = Math.round(pct * (totalSteps - 1)); }}}
					onmouseenter={() => { if (!userDragging && sliderRef) { const rect = sliderRef.getBoundingClientRect(); const event = { clientX: rect.left + (rect.width * 0.5) } as MouseEvent; const pct = (event.clientX - rect.left) / rect.width; hoverIdx = Math.round(pct * (totalSteps - 1)); }}}
					ontouchmove={(e) => { if (!userDragging && sliderRef) { const rect = sliderRef.getBoundingClientRect(); const pct = (e.touches[0].clientX - rect.left) / rect.width; hoverIdx = Math.round(pct * (totalSteps - 1)); e.preventDefault(); }}}
					ontouchend={() => { hoverIdx = null; }}
					role="slider"
					aria-valuemin="0"
					aria-valuemax={totalSteps - 1}
					aria-valuenow={userEndIdx}
					aria-label="Timeline scrubber"
					tabindex="0"
					onkeydown={(e) => {
						if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
							e.preventDefault();
							const step = e.key === "ArrowLeft" ? -1 : 1;
							onUserEndChange(Math.min(Math.max(userEndIdx + step, 0), totalSteps - 1));
						}
					}}
				>
					<!-- User filter range (static) -->
					<div 
						class="user-filter-range" 
						style="left: {dragStartPct}%; width: {dragEndPct - dragStartPct}%;"
					></div>
					<div class="filter-handle filter-start" 
						role="presentation"
						style="left: {dragHandle === 'start' && dragPreviewIdx !== null ? (dragPreviewIdx / (totalSteps - 1)) * 100 : dragStartPct}%;"
						onmousedown={(e) => startDrag('start', e)}
						onmousemove={(e) => { if (userDragging) onDragMove(e); }}
						onmouseup={onDragEnd}
						onmouseleave={onDragEnd}
					></div>
					<div class="filter-handle filter-end" 
						role="presentation"
						style="left: {dragHandle === 'end' && dragPreviewIdx !== null ? (dragPreviewIdx / (totalSteps - 1)) * 100 : dragEndPct}%;"
						onmousedown={(e) => startDrag('end', e)}
						onmousemove={(e) => { if (userDragging) onDragMove(e); }}
						onmouseup={onDragEnd}
						onmouseleave={onDragEnd}
					></div>

					<!-- Playing window (animated) -->
					{#if playing}
						<div 
							class="play-window" 
							style="left: {playWindowStartPct}%; width: {windowWidthPct}%;"
						>
							<div class="playhead" style="left: 100%;"></div>
						</div>
					{/if}

					<!-- Tick marks for match dates -->
					{#each ALL_MATCH_DATES as date, i}
						<div 
							class="slider-tick"
							style="left: {totalSteps > 1 ? (i / (totalSteps - 1)) * 100 : 0}%;"
							title={date}
						></div>
					{/each}

					<!-- Hover tooltip -->
					{#if hoverIdx !== null && hoverIdx < ALL_MATCH_DATES.length}
						<div class="slider-tooltip" style="left: {(hoverIdx / (totalSteps - 1)) * 100}%;">
							{formatDate(ALL_MATCH_DATES[hoverIdx])}
						</div>
					{/if}
				</div>

				<div class="slider-labels">
					<span class="label-start">{formatDate(ALL_MATCH_DATES[0])}</span>
					<span class="label-end">{formatDate(ALL_MATCH_DATES[totalSteps - 1])}</span>
				</div>
			</div>

			<!-- Play controls -->
			<div class="timeline-controls">
				<button class="btn btn-sm" onclick={togglePlay} disabled={totalSteps === 0 || playing}>
					{playing ? "⏸" : "▶"} {playing ? "Pause" : "Play"}
				</button>
				<button class="btn btn-sm" onclick={stopPlay} disabled={!playing}>Stop</button>
				<div class="speed-control">
					<label for="timeline-speed">Speed:</label>
					<input id="timeline-speed" type="range" min="0.25" max="4" step="0.25" bind:value={playSpeed} />
					<span>{playSpeed}x</span>
				</div>
				<div class="play-info">
					{playing 
						? `Playing: ${formatDate(currentPlayDate)} → ${formatDate(currentPlayDateEnd)}` 
						: `Filter: ${formatDate(ALL_MATCH_DATES[userStartIdx])} → ${formatDate(ALL_MATCH_DATES[userEndIdx])}`}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.timeline-wrap {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		background: var(--panel, #1a1a1a);
		border-top: 1px solid var(--border, #333);
		z-index: 100;
		font-family: system-ui, sans-serif;
	}
	.timeline-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		height: 25px;
		padding: 0 12px;
		cursor: pointer;
		user-select: none;
	}
	.timeline-title {
		font-size: 0.8rem;
		font-weight: 600;
		opacity: 0.8;
	}
	.timeline-toggle {
		background: none;
		border: none;
		font-size: 1rem;
		cursor: pointer;
		padding: 2px 6px;
	}
	.timeline-content {
		padding: 8px 12px;
		max-height: 280px;
		overflow-y: auto;
	}
	.histogram {
		position: relative;
		height: 80px;
		margin-bottom: 8px;
	}
	.histogram-bar {
		position: absolute;
		bottom: 0;
		min-height: 20px;
		background: var(--accent, #007acc);
		border: 1px solid var(--fg, #fff);
		border-radius: 2px;
		font-size: 0.6rem;
		color: var(--fg, #fff);
		transition: background 0.2s, border-color 0.2s, opacity 0.2s, transform 0.1s, box-shadow 0.2s;
		cursor: pointer;
		padding: 0;
		display: flex;
		justify-content: flex-end;
		align-items: flex-end;
		box-sizing: border-box;
		opacity: 0.8;
	}
	.histogram-bar:hover {
		background: var(--accent-hover, #00aaff);
		border-color: var(--fg, #fff);
		opacity: 1;
		transform: scaleY(1.05);
		box-shadow: 0 -4px 12px rgba(0, 170, 255, 0.4);
		z-index: 5;
	}
	.histogram-bar.active {
		background: var(--accent-active, #ff6b00);
		border-color: var(--fg, #fff);
		opacity: 1;
	}
	.histogram-bar:hover {
		background: var(--accent-hover, #00aaff);
	}
	.histogram-bar.active {
		background: var(--accent-active, #ff6b00);
	}
	.bar-count {
		position: absolute;
		top: 2px;
		right: 2px;
		font-size: 0.6rem;
		opacity: 0.8;
	}
	.histogram-axis {
		display: flex;
		justify-content: space-between;
		font-size: 0.65rem;
		opacity: 0.5;
		margin-top: 2px;
	}
	.slider-wrap {
		position: relative;
		height: 40px;
		margin: 8px 0;
	}
	.slider-track {
		position: relative;
		height: 8px;
		background: var(--border, #333);
		border-radius: 4px;
		cursor: pointer;
		margin-top: 16px;
	}
	.user-filter-range {
		position: absolute;
		top: 0;
		height: 100%;
		background: var(--accent, rgba(0, 122, 204, 0.3));
		border: 2px solid var(--accent, #007acc);
		border-radius: 4px;
		box-sizing: border-box;
		z-index: 2;
	}
.filter-handle {
   position: absolute;
   top: -6px;
   width: 16px;
   height: 20px;
   background: var(--accent, #007acc);
   border: 2px solid var(--bg, #1a1a1a);
   border-radius: 50%;
   margin-left: -8px;
   cursor: ew-resize;
   z-index: 3;
   transition: transform 0.1s;
}
	.filter-handle:hover {
		transform: scale(1.2);
	}
	.play-window {
		position: absolute;
		top: 0;
		height: 100%;
		background: var(--accent-active, rgba(255, 107, 0, 0.3));
		border: 2px solid var(--accent-active, #ff6b00);
		border-radius: 4px;
		box-sizing: border-box;
		z-index: 1;
		pointer-events: none;
		transition: left 0.05s linear, width 0.05s linear;
	}
	.playhead {
		position: absolute;
		top: -8px;
		right: -6px;
		width: 12px;
		height: 12px;
		background: var(--accent-active, #ff6b00);
		border: 2px solid var(--bg, #1a1a1a);
		border-radius: 50%;
		transform: translateX(50%);
		box-shadow: 0 0 8px var(--accent-active, #ff6b00);
		animation: pulse 1s ease-in-out infinite;
	}
	@keyframes pulse {
		0%, 100% { box-shadow: 0 0 8px var(--accent-active, #ff6b00); }
		50% { box-shadow: 0 0 16px var(--accent-active, #ff6b00); }
	}
	.slider-tick {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--fg, #fff);
		opacity: 0.15;
		pointer-events: none;
		z-index: 0;
	}
	.slider-labels {
		display: flex;
		justify-content: space-between;
		font-size: 0.65rem;
		opacity: 0.5;
		margin-top: 4px;
	}
	.slider-tooltip {
		position: absolute;
		bottom: 100%;
		left: 0;
		transform: translateX(-50%);
		background: var(--bg, #1a1a1a);
		border: 1px solid var(--border, #333);
		border-radius: 4px;
		padding: 2px 6px;
		font-size: 0.65rem;
		color: var(--fg, #fff);
		white-space: nowrap;
		pointer-events: none;
		z-index: 10;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	}
	.timeline-controls {
		display: flex;
		gap: 12px;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 8px;
	}
	.timeline-controls .btn {
		font-size: 0.75rem;
		padding: 4px 10px;
	}
	.speed-control {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.75rem;
		opacity: 0.8;
	}
	.speed-control input {
		width: 100px;
	}
	.play-info {
		font-size: 0.7rem;
		opacity: 0.6;
		margin-left: auto;
		font-family: monospace;
	}
</style>