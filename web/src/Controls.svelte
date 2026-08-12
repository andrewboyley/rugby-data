<script>
	let {
		minW = $bindable(1),
		maxW = $bindable(45),
		maxD = $bindable(90),
		team = $bindable(null),
		dateStart = $bindable(null),
		dateEnd = $bindable(null),
		teams = {},
		maxDeg = 90,
		dateMin = null,
		dateMax = null,
		edgeColor = $bindable("none"),
	} = $props();

	const sortedTeams = $derived(Object.entries(teams).sort((a, b) => a[1].localeCompare(b[1])));

	const pct = (v, lo, hi) => (hi === lo ? 0 : ((v - lo) / (hi - lo)) * 100);
	const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

	const WMIN = 1,
		WMAX = 45;
	const wLoPct = $derived(pct(minW, WMIN, WMAX));
	const wHiPct = $derived(pct(maxW, WMIN, WMAX));

	function onMinW(e) {
		minW = Math.min(+e.currentTarget.value, maxW);
	}
	function onMaxW(e) {
		maxW = Math.max(+e.currentTarget.value, minW);
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
		const v = Math.min(+e.currentTarget.value, dHi);
		dLo = v;
		dateStart = dateOf(v);
	}
	function onDateHi(e) {
		const v = Math.max(+e.currentTarget.value, dLo);
		dHi = v;
		dateEnd = dateOf(v);
	}
	$effect(() => {
		dLo = dayOf(dateStart);
	});
	$effect(() => {
		dHi = dayOf(dateEnd);
	});

	let teamSel = $state(team == null ? "" : String(team));
	$effect(() => {
		team = teamSel === "" ? null : Number(teamSel);
	});
	$effect(() => {
		const want = team == null ? "" : String(team);
		if (teamSel !== want) teamSel = want;
	});
</script>

<div class="control">
	<label for="minw">Shared matches</label>
	<span class="dual" style="--lo:{wLoPct}%;--hi:{wHiPct}%">
		<input type="range" id="minw" class="lo" value={minW} min={WMIN} max={WMAX} oninput={onMinW} />
		<input type="range" class="hi" value={maxW} min={WMIN} max={WMAX} oninput={onMaxW} />
	</span>
	<span>{minW}–{maxW}</span>
</div>
<div class="control">
	<label for="maxd">Max degree</label>
	<input type="range" id="maxd" min="1" max={maxDeg} bind:value={maxD} />
	<span>{maxD}</span>
</div>
<div class="control">
	<label for="team">Team</label>
	<select class="team" id="team" bind:value={teamSel}>
		<option value="">All teams</option>
		{#each sortedTeams as [tid, name]}
			<option value={tid}>{name}</option>
		{/each}
	</select>
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
			disabled={!dateMin}
			oninput={onDateLo}
		/>
		<input
			type="range"
			class="hi"
			value={dHi}
			min="0"
			max={totalDays}
			disabled={!dateMin}
			oninput={onDateHi}
		/>
	</span>
	<span>{dateStart ?? "…"} – {dateEnd ?? "…"}</span>
</div>
<div class="control">
	<label for="edgecolor">Edge colour</label>
	<select id="edgecolor" bind:value={edgeColor}>
		<option value="none">Shared matches</option>
		<option value="winrate">Avg win rate</option>
	</select>
</div>
