<script>
	import { teamName } from "./lib.js";

	let { nodes, teams, onPick } = $props();

	let q = $state("");
	let open = $state(false);

	const hits = $derived.by(() => {
		const s = q.trim().toLowerCase();
		if (!s) {
			return nodes
				.slice()
				.sort((a, b) => b.app - a.app)
				.slice(0, 50);
		}
		return nodes
			.filter((n) => n.name.toLowerCase().includes(s))
			.sort((a, b) => b.app - a.app)
			.slice(0, 12);
	});
</script>

<svelte:window
	onclick={(ev) => {
		if (ev.target instanceof Element && !ev.target.closest(".search-wrap")) open = false;
	}}
/>

<div class="search-wrap">
	<input
		id="search"
		placeholder="Find player..."
		bind:value={q}
		onfocus={() => (open = true)}
		oninput={() => (open = true)}
	/>
	{#if open && hits.length}
		<div id="search-results">
			{#each hits as d (d.id)}
				<div
					role="button"
					tabindex="0"
					onkeydown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							open = false;
							onPick(d);
						}
					}}
					onmousedown={(e) => e.preventDefault()}
					onclick={(e) => {
						e.stopPropagation();
						open = false;
						onPick(d);
					}}
				>
					<b>{d.name}</b> &middot; {d.app} apps
					<span class="team">
						{#if d.teams.length}
							{d.teams.map(tid => teamName(teams, tid)).join(', ')}
						{:else}
							{teamName(teams, d.team)}
						{/if}
					</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
