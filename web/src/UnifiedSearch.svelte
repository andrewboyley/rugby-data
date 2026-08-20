<script lang="ts">
	import { searchGames, teamName } from "./lib.ts";
	import type { Player, Game, RawTeamInfo, GraphNode as Node } from "./types.ts";

	let {
		nodes,
		coaches,
		teams,
		games,
		playerName,
		onPickPlayer,
		onPickMatch,
		onPickTeam,
		onPickVenue,
		selectedId,
	}: {
		nodes: Player[];
		coaches: Node[];
		teams: Record<number, RawTeamInfo>;
		games: Game[];
		playerName: (id: number) => string;
		onPickPlayer: (d: Node) => void;
		onPickMatch: (g: Game) => void;
		onPickTeam: (tid: number) => void;
		onPickVenue: (venue: { name: string | null; city: string | null; country: string | null }) => void;
		selectedId: number | null;
	} = $props();

	let q = $state("");
	let open = $state(false);

	$effect(() => {
		const id = selectedId;
		if (id == null) {
			q = "";
			open = false;
			return;
		}
		const n = nodes.find((x) => x.id === id);
		if (n) {
			q = n.name;
			open = false;
		}
	});

	const sortedTeams = $derived.by(() =>
		Object.entries(teams)
			.map(([tid, v]) => [tid, typeof v === "string" ? v : v?.name || ""] as const)
			.sort((a, b) => a[1].localeCompare(b[1])),
	);

	const players = $derived.by(() => {
		const s = q.trim().toLowerCase();
		if (!s) {
			return nodes
				.slice()
				.sort((a, b) => b.app - a.app)
				.slice(0, 8);
		}
		return nodes
			.filter((n) => n.name.toLowerCase().includes(s))
			.sort((a, b) => b.app - a.app)
			.slice(0, 8);
	});

	const matches = $derived(searchGames(games, q, teams, playerName).slice(0, 8));

	const teamHits = $derived.by(() => {
		const s = q.trim().toLowerCase();
		if (!s) return [];
		return sortedTeams
			.filter(([, name]) => name.toLowerCase().includes(s))
			.slice(0, 6);
	});

	const coachHits = $derived.by(() => {
		const s = q.trim().toLowerCase();
		if (!s) return [];
		return coaches
			.filter((c) => c.name.toLowerCase().includes(s))
			.sort((a, b) => b.app - a.app)
			.slice(0, 6);
	});

	const jerseyHits = $derived.by(() => {
		const num = parseInt(q.trim(), 10);
		if (Number.isNaN(num)) return [];
		return nodes
			.filter((n) => n.jersey === num)
			.sort((a, b) => b.app - a.app)
			.slice(0, 8);
	});

	const venues = $derived.by(() => {
		const s = q.trim().toLowerCase();
		if (!s) return [];
		const byName = new Map<string, { name: string | null; city: string | null; country: string | null; games: Game[] }>();
		for (const g of games) {
			const v = g.venue;
			if (!v || !v.name) continue;
			if (!byName.has(v.name)) byName.set(v.name, { ...v, games: [] });
			byName.get(v.name)!.games.push(g);
		}
		return [...byName.values()]
			.filter(
				(v) =>
					(v.name ?? "").toLowerCase().includes(s) ||
					(v.city ?? "").toLowerCase().includes(s) ||
					(v.country ?? "").toLowerCase().includes(s),
			)
			.slice(0, 6);
	});

	const hasAny = $derived(
		players.length > 0 ||
			matches.length > 0 ||
			teamHits.length > 0 ||
			coachHits.length > 0 ||
			jerseyHits.length > 0 ||
			venues.length > 0,
	);
	const searching = $derived(q.trim().length > 0);

	function side(g: Game, home: boolean) {
		const c = (g.competitors ?? []).find((x) => x.home === home) ?? g.competitors?.[home ? 0 : 1];
		return c ?? null;
	}
	function summary(g: Game) {
		const h = side(g, true);
		const a = side(g, false);
		const hName = h ? teamName(teams, h.teamId) : "?";
		const aName = a ? teamName(teams, a.teamId) : "?";
		const hScore = h?.score ?? "?";
		const aScore = a?.score ?? "?";
		const venue = [g.venue?.name, g.venue?.city].filter(Boolean).join(", ");
		return { date: g.date ?? "", line: `${hName} ${hScore} – ${aScore} ${aName}`, venue };
	}

	function pick(pick: () => void) {
		open = false;
		pick();
	}
</script>

<svelte:window
	onclick={(ev) => {
		if (ev.target instanceof Element && !ev.target.closest(".unified-search")) open = false;
	}}
	onkeydown={(e) => {
		if (e.key === "Escape") open = false;
	}}
/>

<div class="unified-search relative">
	<div class="flex items-center gap-2">
		<div class="relative flex-1">
			<svg
				class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/50"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<circle cx="11" cy="11" r="7" />
				<line x1="21" y1="21" x2="16.65" y2="16.65" />
			</svg>
			<input
				id="unified-search-input"
				placeholder="Search players, matches, teams…"
				bind:value={q}
				onfocus={() => (open = true)}
				oninput={() => (open = true)}
				class="w-full rounded-md border border-base-300 bg-base-100 py-2 pl-9 pr-3 text-base-content placeholder:text-base-content/40 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
			/>
		</div>
		{#if q.length > 0}
			<button
				onclick={() => (q = "")}
				class="btn btn-ghost btn-sm opacity-60 hover:opacity-100"
				aria-label="Clear search"
			>
				×
			</button>
		{/if}
	</div>
	{#if open}
		<div
			class="absolute left-0 right-0 z-[60] mt-2 max-h-[360px] w-full overflow-y-auto rounded-md border border-base-300 bg-base-100 shadow-xl"
		>
			{#if !searching}
				<div class="space-y-2.5 px-3 py-3 text-sm text-base-content/70">
					<p class="font-semibold text-base-content/80">Search the graph</p>
					<ul class="list-disc space-y-0.5 pl-4">
						<li>Type a player, coach or team name</li>
						<li>Type a jersey number to find its wearers</li>
						<li>Type a venue or city to find matches there</li>
						<li>Type a score like <code class="text-base-content/80">33-19</code> to find matches</li>
					</ul>
					<p class="font-semibold text-base-content/80">Combine terms</p>
					<ul class="list-disc space-y-0.5 pl-4">
						<li>All words must match, so stack them to narrow — e.g. <code class="text-base-content/80">Ireland 2023</code> or <code class="text-base-content/80">Paris 33-19</code></li>
						<li>Mix a team with a player, opponent or venue to jump straight to one match</li>
					</ul>
					<p class="font-semibold text-base-content/80">Best way to filter</p>
					<ul class="list-disc space-y-0.5 pl-4">
						<li>Use the sliders above (min games, min degree, date range) to shrink the graph first</li>
						<li>Toggle <b>Show Edges</b> / <b>Coaches</b> and the jersey/team colours to isolate what you care about</li>
						<li>Then search to pinpoint a node, match or venue within the filtered set</li>
					</ul>
				</div>
			{:else}
				{#if players.length}
				<p class="menu-title px-3 pt-2 text-xs font-semibold uppercase tracking-wider text-base-content/50">
					Players
				</p>
				{#each players as d (d.id)}
					<button
						type="button"
						class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left hover:bg-base-200/50 focus-visible:bg-base-200/50 focus-visible:outline-none"
						onmousedown={(e) => e.preventDefault()}
						onclick={() => pick(() => onPickPlayer(d))}
					>
						<span class="flex-1 min-w-0">
							<b class="block truncate text-sm">{d.name}</b>
							<span class="text-xs text-base-content/60">{d.app} apps</span>
						</span>
						<span class="max-w-[45%] truncate text-xs text-base-content/60">
							{#if d.teams.length}
								{d.teams.map((tid) => teamName(teams, tid)).join(", ")}
							{:else}
								{teamName(teams, d.team)}
							{/if}
						</span>
					</button>
				{/each}
			{/if}

			{#if searching && matches.length}
				<p class="menu-title px-3 pt-2 text-xs font-semibold uppercase tracking-wider text-base-content/50">
					Matches
				</p>
				{#each matches as g (g.eventId)}
					{@const s = summary(g)}
					<button
						type="button"
						class="flex w-full cursor-pointer flex-col px-3 py-2 text-left hover:bg-base-200/50 focus-visible:bg-base-200/50 focus-visible:outline-none"
						onmousedown={(e) => e.preventDefault()}
						onclick={() => pick(() => onPickMatch(g))}
					>
						<span class="flex items-baseline justify-between gap-2">
							<b class="truncate text-sm">{s.line}</b>
							<span class="text-xs whitespace-nowrap text-base-content/60">{s.date}</span>
						</span>
						{#if s.venue}
							<span class="truncate text-xs text-base-content/60">{s.venue}</span>
						{/if}
					</button>
				{/each}
			{/if}

			{#if teamHits.length}
				<p class="menu-title px-3 pt-2 text-xs font-semibold uppercase tracking-wider text-base-content/50">
					Teams
				</p>
				{#each teamHits as [tid, name]}
					<button
						type="button"
						class="flex w-full cursor-pointer items-center px-3 py-2 text-left text-sm hover:bg-base-200/50 focus-visible:bg-base-200/50 focus-visible:outline-none"
						onmousedown={(e) => e.preventDefault()}
						onclick={() => pick(() => onPickTeam(Number(tid)))}
					>
						<span class="truncate">{name}</span>
					</button>
				{/each}
			{/if}

			{#if coachHits.length}
				<p class="menu-title px-3 pt-2 text-xs font-semibold uppercase tracking-wider text-base-content/50">
					Coaches
				</p>
				{#each coachHits as c (c.id)}
					<button
						type="button"
						class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left hover:bg-base-200/50 focus-visible:bg-base-200/50 focus-visible:outline-none"
						onmousedown={(e) => e.preventDefault()}
						onclick={() => pick(() => onPickPlayer(c))}
					>
						<span class="flex-1 min-w-0">
							<b class="block truncate text-sm">{c.name}</b>
							<span class="text-xs text-base-content/60">{c.app} appearances</span>
						</span>
						<span class="max-w-[45%] truncate text-xs text-base-content/60">
							{c.teams.length
								? c.teams.map((tid) => teamName(teams, tid)).join(", ")
								: teamName(teams, c.team)}
						</span>
					</button>
				{/each}
			{/if}

			{#if jerseyHits.length}
				<p class="menu-title px-3 pt-2 text-xs font-semibold uppercase tracking-wider text-base-content/50">
					Jersey {parseInt(q.trim(), 10)}
				</p>
				{#each jerseyHits as d (d.id)}
					<button
						type="button"
						class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left hover:bg-base-200/50 focus-visible:bg-base-200/50 focus-visible:outline-none"
						onmousedown={(e) => e.preventDefault()}
						onclick={() => pick(() => onPickPlayer(d))}
					>
						<span class="flex-1 min-w-0">
							<b class="block truncate text-sm">{d.name}</b>
							<span class="text-xs text-base-content/60">{d.app} apps</span>
						</span>
						<span class="max-w-[45%] truncate text-xs text-base-content/60">
							{d.teams.length
								? d.teams.map((tid) => teamName(teams, tid)).join(", ")
								: teamName(teams, d.team)}
						</span>
					</button>
				{/each}
			{/if}

			{#if venues.length}
				<p class="menu-title px-3 pt-2 text-xs font-semibold uppercase tracking-wider text-base-content/50">
					Venues
				</p>
				{#each venues as v}
					<button
						type="button"
						class="flex w-full cursor-pointer flex-col px-3 py-2 text-left hover:bg-base-200/50 focus-visible:bg-base-200/50 focus-visible:outline-none"
						onmousedown={(e) => e.preventDefault()}
						onclick={() => pick(() => onPickVenue({ name: v.name, city: v.city, country: v.country }))}
					>
						<b class="truncate text-sm">{v.name}</b>
						<span class="text-xs text-base-content/60">
							{[v.city, v.country].filter(Boolean).join(", ")} &middot; {v.games.length}
							{v.games.length === 1 ? " match" : " matches"}
						</span>
					</button>
				{/each}
			{/if}

			{#if searching && !hasAny}
				<p class="px-3 py-2 text-center text-sm text-base-content/60">No results</p>
			{/if}
			{/if}
		</div>
	{/if}
</div>
