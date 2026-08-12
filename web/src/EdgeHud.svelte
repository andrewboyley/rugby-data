<script>
	import { teamName } from "./lib.js";

	let { edge, gamesByDate, teams, onClear } = $props();

	function gameRow(d) {
		const g = gamesByDate?.get(d);
		if (!g || edge.team == null) return { date: d, opponent: null, score: null };
		const side = g.competitors.find((c) => c.teamId === edge.team);
		const opp = g.competitors.find((c) => c !== side);
		if (!side || !opp) return { date: d, opponent: null, score: null };
		return {
			date: d,
			opponent: teamName(teams, opp.teamId),
			score: `${Math.max(side.score, opp.score)}–${Math.min(side.score, opp.score)}`,
		};
	}
</script>

{#if edge}
	<div id="edge-hud">
		<div class="name">{edge.a} &mdash; {edge.b}</div>
		<div class="row">{edge.w} shared matches</div>
		<div class="links">
			{#each edge.dates as d (d)}
				{@const row = gameRow(d)}
				<div class="game">
					<span class="gdate">{d}</span>
					{#if row.opponent}
						<span class="gopp">vs {row.opponent} · {row.score}</span>
					{:else}
						<span class="gopp">{row.opponent ?? "match"}</span>
					{/if}
				</div>
			{/each}
		</div>
		<button class="btn clear" onclick={onClear}>clear</button>
	</div>
{/if}
