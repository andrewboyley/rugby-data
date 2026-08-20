<script>
	let {
		minW = $bindable(1),
		minD = $bindable(1),
		maxWeight = 45,
		maxDeg = 90,
		edgeColor = $bindable("none"),
		alphaMin = $bindable(0.05),
		alphaMax = $bindable(0.6),
		nodeColor = $bindable("jersey"),
		showCoaches = $bindable(false),
		showMetaballs = $bindable(false),
		showEdges = $bindable(false),
		onEdgeAlpha = () => {},
		onEdgeColor = () => {},
	} = $props();

	// Sliders keep local draft values that update on every input event (so the
	// number label moves in real time), but the bound filter props are only
	// written on the change event — which fires once the user releases the
	// slider. The graph therefore only rebuilds when the user is done dragging.
	let wDraft = $state(minW);
	let dDraft = $state(minD);
	$effect(() => {
		wDraft = minW;
	});
	$effect(() => {
		dDraft = minD;
	});

	let viewOpen = $state(false);
	let filtersOpen = $state(false);
	let viewMenuEl = $state();
	let filtersMenuEl = $state();

	$effect(() => {
		if (!viewOpen && !filtersOpen) return;
		const onKey = (e) => {
			if (e.key === "Escape") {
				viewOpen = false;
				filtersOpen = false;
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	// Close a dropdown when clicking outside its menu element.
	$effect(() => {
		const el = filtersMenuEl;
		if (!el) return;
		const onDoc = (e) => {
			if (!el.contains(e.target)) filtersOpen = false;
		};
		window.addEventListener("click", onDoc);
		return () => window.removeEventListener("click", onDoc);
	});
	$effect(() => {
		const el = viewMenuEl;
		if (!el) return;
		const onDoc = (e) => {
			if (!el.contains(e.target)) viewOpen = false;
		};
		window.addEventListener("click", onDoc);
		return () => window.removeEventListener("click", onDoc);
	});

	function commitW() {
		minW = wDraft;
	}
	function commitD() {
		minD = dDraft;
	}
</script>

{#snippet rangeSlider(label, min, max, val, onInput, onCommit)}
	<div class="flex flex-col gap-1.5">
		<div class="flex items-center justify-between text-sm">
			<span class="text-base-content/70">{label}</span>
			<span class="font-semibold tabular-nums">{val}</span>
		</div>
		<input
			type="range"
			min={min}
			max={max}
			step="1"
			class="range w-full"
			value={val}
			oninput={onInput}
			onchange={onCommit}
		/>
	</div>
{/snippet}

<!-- All filter controls, grouped, with normal-sized inputs. Shared by the
     desktop "View" dropdown and the mobile "Filters" dropdown. -->
{#snippet filterControls()}
	<div class="flex flex-col gap-5">
		<section class="flex flex-col gap-3">
			<h4 class="text-xs font-semibold uppercase tracking-wider text-base-content/50">Thresholds</h4>
			{@render rangeSlider(
				"Shared matches",
				1,
				maxWeight,
				wDraft,
				(e) => (wDraft = +e.currentTarget.value),
				commitW,
			)}
			{@render rangeSlider(
				"Degree",
				1,
				maxDeg,
				dDraft,
				(e) => (dDraft = +e.currentTarget.value),
				commitD,
			)}
		</section>

		<section class="flex flex-col gap-3">
			<h4 class="text-xs font-semibold uppercase tracking-wider text-base-content/50">Appearance</h4>
			<label class="flex items-center justify-between gap-2 text-sm">
				<span class="text-base-content/70">Node colour</span>
				<select class="select select-bordered" bind:value={nodeColor}>
					<option value="jersey">Jersey number</option>
					<option value="team">Team</option>
					<option value="neutral">Neutral</option>
				</select>
			</label>
			<label class="flex items-center justify-between gap-2 text-sm">
				<span class="text-base-content/70">Edge colour</span>
				<select
					class="select select-bordered"
					value={edgeColor}
					onchange={(e) => {
						edgeColor = e.currentTarget.value;
						onEdgeColor(edgeColor);
					}}
				>
					<option value="none">Shared matches</option>
					<option value="winrate">Avg win rate</option>
				</select>
			</label>
			<div class="flex flex-col gap-1">
				<span class="text-xs text-base-content/60">Edge opacity (min)</span>
				<input
					type="range"
					min="0.05"
					max="1"
					step="0.05"
					class="range w-full"
					value={alphaMin}
					oninput={(e) => {
						alphaMin = +e.currentTarget.value;
						onEdgeAlpha(alphaMin, alphaMax);
					}}
				/>
				<span class="text-xs text-base-content/60">Edge opacity (max)</span>
				<input
					type="range"
					min="0.05"
					max="1"
					step="0.05"
					class="range w-full"
					value={alphaMax}
					oninput={(e) => {
						alphaMax = +e.currentTarget.value;
						onEdgeAlpha(alphaMin, alphaMax);
					}}
				/>
			</div>
		</section>

		<section class="flex flex-col gap-3">
			<h4 class="text-xs font-semibold uppercase tracking-wider text-base-content/50">Layers</h4>
			<label class="flex cursor-pointer items-center gap-2 text-sm">
				<input type="checkbox" class="checkbox" bind:checked={showEdges} />
				<span>Show edges</span>
			</label>
			<label class="flex cursor-pointer items-center gap-2 text-sm">
				<input type="checkbox" class="checkbox" bind:checked={showCoaches} />
				<span>Show coaches</span>
			</label>
			<label class="flex cursor-pointer items-center gap-2 text-sm">
				<input type="checkbox" class="checkbox" bind:checked={showMetaballs} />
				<span>Show metaballs</span>
			</label>
		</section>
	</div>
{/snippet}

<!-- Desktop: a "View" dropdown for everything -->
<div class="flex">
	<div class="relative" bind:this={viewMenuEl}>
		<button
			type="button"
			class="btn btn-sm btn-outline"
			tabindex="0"
			onclick={() => (viewOpen = !viewOpen)}
		>
			View
		</button>
		{#if viewOpen}
			<div
				class="absolute left-0 z-40 mt-2 w-72 rounded-box border border-base-200 bg-base-100 p-4 shadow-xl"
			>
				{@render filterControls()}
			</div>
		{/if}
	</div>
</div>

<!-- Mobile: a single "Filters" dropdown with everything grouped -->
<div class="hidden" bind:this={filtersMenuEl}>
	<button
		type="button"
		class="btn btn-primary btn-sm"
		onclick={() => (filtersOpen = !filtersOpen)}
	>
		Filters
	</button>
	{#if filtersOpen}
		<div
			class="absolute left-0 z-40 mt-2 w-72 max-w-[90vw] rounded-box border border-base-200 bg-base-100 p-4 shadow-xl"
		>
			{@render filterControls()}
		</div>
	{/if}
</div>
