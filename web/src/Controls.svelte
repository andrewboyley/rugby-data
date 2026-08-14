<script>
	let {
		minW = $bindable(1),
		maxW = $bindable(45),
		minD = $bindable(1),
		maxD = $bindable(90),
		team = $bindable(null),
		dateStart = $bindable(null),
		dateEnd = $bindable(null),
		teams = {},
		maxDeg = 90,
		maxWCap = 45,
		dateMin = null,
		dateMax = null,
		edgeColor = $bindable("none"),
		alphaMin = $bindable(0.05),
		alphaMax = $bindable(0.6),
		nodeColor = $bindable("jersey"),
		onTeamZoom = () => {},
		onEdgeAlpha = () => {},
		onEdgeColor = () => {},
	} = $props();

	const sortedTeams = $derived(
		Object.entries(teams)
			.map(([tid, v]) => [tid, typeof v === "string" ? v : v?.name || ""])
			.sort((a, b) => a[1].localeCompare(b[1])),
	);

	const filteredTeams = $derived.by(() => {
		const s = teamSearch.trim().toLowerCase();
		if (!s) return sortedTeams;
		return sortedTeams.filter(([ , name]) => name.toLowerCase().includes(s));
	});

	const pct = (v, lo, hi) => (hi === lo ? 0 : ((v - lo) / (hi - lo)) * 100);
	const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

	const WMIN = 1;
	const WMAX = $derived(Math.max(WMIN, maxWCap));

	// The sliders keep local draft values that update on every input event
	// (so the number text and handle move in real time), but the bound filter
	// props are only written on the change event — which fires once the user
	// releases the slider. The graph therefore only rebuilds when the user is
	// done dragging, not on every input event.
	let wLo = $state(minW);
	let wHi = $state(maxW);
	$effect(() => {
		wLo = minW;
	});
	$effect(() => {
		wHi = maxW;
	});
	const wLoPct = $derived(pct(wLo, WMIN, WMAX));
	const wHiPct = $derived(pct(wHi, WMIN, WMAX));

	function commitW() {
		let lo = clamp(wLo, WMIN, WMAX);
		let hi = clamp(wHi, WMIN, WMAX);
		if (lo > hi) [lo, hi] = [hi, lo];
		minW = lo;
		maxW = hi;
	}

	function onWLo(e) {
		wLo = +e.currentTarget.value;
	}
	function onWHi(e) {
		wHi = +e.currentTarget.value;
	}

	const DMIN = 1;
	const DMAX = $derived(Math.max(DMIN, maxDeg));
	let dgLo = $state(minD);
	let dgHi = $state(maxD);
	$effect(() => {
		dgLo = minD;
	});
	$effect(() => {
		dgHi = maxD;
	});
	const degLoPct = $derived(pct(dgLo, DMIN, DMAX));
	const degHiPct = $derived(pct(dgHi, DMIN, DMAX));

	function commitDg() {
		let lo = clamp(dgLo, DMIN, DMAX);
		let hi = clamp(dgHi, DMIN, DMAX);
		if (lo > hi) [lo, hi] = [hi, lo];
		minD = lo;
		maxD = hi;
	}

	function onDgLo(e) {
		dgLo = +e.currentTarget.value;
	}
	function onDgHi(e) {
		dgHi = +e.currentTarget.value;
	}
	const totalDays = $derived(
		dateMin && dateMax
			? clamp(Math.round((Date.parse(dateMax) - Date.parse(dateMin)) / 864e5), 0, 4000)
			: 0,
	);
	const dayOf = (d) =>
		d && dateMin ? Math.round((Date.parse(d) - Date.parse(dateMin)) / 864e5) : 0;
	const dateOf = (i) => new Date(Date.parse(dateMin) + i * 864e5).toISOString().slice(0, 10);

	let dLo = $state(dayOf(dateStart));
	let dHi = $state(dayOf(dateEnd));
	const dLoPct = $derived(pct(dLo, 0, totalDays));
	const dHiPct = $derived(pct(dHi, 0, totalDays));

	function onDateLo(e) {
		dLo = Math.min(+e.currentTarget.value, dHi);
	}
	function onDateHi(e) {
		dHi = Math.max(+e.currentTarget.value, dLo);
	}
	function commitDateLo() {
		dateStart = dateOf(dLo);
	}
	function commitDateHi() {
		dateEnd = dateOf(dHi);
	}
	$effect(() => {
		dLo = dateStart == null ? 0 : dayOf(dateStart);
	});
	$effect(() => {
		dHi = dateEnd == null ? totalDays : dayOf(dateEnd);
	});

let teamSearch = $state("");
let open = $state(false);
</script>

<svelte:window
	onclick={(ev) => {
		if (ev.target instanceof Element && !ev.target.closest(".search-wrap")) open = false;
	}}
	onkeydown={(ev) => {
		if (ev.key === "Escape") open = false;
	}}
/>

<div class="control">
	<label for="minw">Shared matches</label>
	<div class="range-row">
		<span class="endval">{wLo}</span>
		<span class="dual" style="--lo:{wLoPct}%;--hi:{wHiPct}%">
			<input type="range" id="minw" class="lo" value={wLo} min={WMIN} max={WMAX} oninput={onWLo} onchange={commitW} />
			<input type="range" class="hi" value={wHi} min={WMIN} max={WMAX} oninput={onWHi} onchange={commitW} />
		</span>
		<span class="endval">{wHi}</span>
	</div>
</div>
<div class="control">
	<label for="mind">Degree</label>
	<div class="range-row">
		<span class="endval">{dgLo}</span>
		<span class="dual" style="--lo:{degLoPct}%;--hi:{degHiPct}%">
			<input type="range" id="mind" class="lo" value={dgLo} min={DMIN} max={DMAX} oninput={onDgLo} onchange={commitDg} />
			<input type="range" id="maxd" class="hi" value={dgHi} min={DMIN} max={DMAX} oninput={onDgHi} onchange={commitDg} />
		</span>
		<span class="endval">{dgHi}</span>
	</div>
</div>
<div class="control team-chips">
	<label for="team-zoom">Zoom to team</label>
	<div class="search-wrap">
		<input
			id="team-zoom"
			type="text"
			placeholder="Zoom to team..."
			bind:value={teamSearch}
			onfocus={() => (open = true)}
			oninput={() => (open = true)}
		/>
		{#if open && filteredTeams.length}
			<div id="team-results">
			{#each filteredTeams as [tid, name]}
				<div
					role="button"
					tabindex="0"
					onkeydown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							open = false;
							onTeamZoom(tid === "" ? null : Number(tid));
						}
					}}
					onmousedown={(e) => e.preventDefault()}
					onclick={(e) => {
						e.stopPropagation();
						open = false;
						onTeamZoom(tid === "" ? null : Number(tid));
					}}
				>
					<b>{name}</b>
				</div>
			{/each}
			</div>
		{/if}
	</div>
</div>
<div class="control">
	<label for="datelo">Date</label>
	<span class="dual" style="--lo:{dLoPct}%;--hi:{dHiPct}%">
		<input
			type="range"
			id="datelo"
			class="lo"
			value={dLo}
			min="0"
			max={totalDays}
			disabled={totalDays === 0}
			oninput={onDateLo}
			onchange={commitDateLo}
		/>
		<input
			type="range"
			class="hi"
			value={dHi}
			min="0"
			max={totalDays}
			disabled={totalDays === 0}
			oninput={onDateHi}
			onchange={commitDateHi}
		/>
	</span>
	<span>{totalDays > 0 ? `${dateOf(dLo)} – ${dateOf(dHi)}` : "… – …"}</span>
</div>
<div class="control">
	<label for="nodecolor">Node colour</label>
	<select id="nodecolor" bind:value={nodeColor}>
		<option value="jersey">Jersey number</option>
		<option value="team">Team</option>
		<option value="neutral">Neutral</option>
	</select>
</div>
<div class="control">
	<label for="edgecolor">Edge colour</label>
	<select id="edgecolor" value={edgeColor} onchange={(e) => { edgeColor = e.currentTarget.value; onEdgeColor(edgeColor); }}>
		<option value="none">Shared matches</option>
		<option value="winrate">Avg win rate</option>
	</select>
</div>
<div class="control">
	<label for="edgealphaLo">Edge alpha</label>
	<div class="range-row">
		<span class="endval">{alphaMin.toFixed(2)}</span>
		<span class="dual" style="--lo:{alphaMin * 100}%;--hi:{alphaMax * 100}%">
			<input id="edgealphaLo" class="lo" type="range" min="0.05" max="1" step="0.05" value={alphaMin} oninput={(e) => { alphaMin = +e.currentTarget.value; onEdgeAlpha(alphaMin, alphaMax); }} />
			<input id="edgealphaHi" class="hi" type="range" min="0.05" max="1" step="0.05" value={alphaMax} oninput={(e) => { alphaMax = +e.currentTarget.value; onEdgeAlpha(alphaMin, alphaMax); }} />
		</span>
		<span class="endval">{alphaMax.toFixed(2)}</span>
	</div>
</div>
