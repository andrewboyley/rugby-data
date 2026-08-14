<script>
	import { teamName } from "./lib.js";

	let { edge, gamesByDate, teams, onClear } = $props();

	function gameRow(d) {
		const g = gamesByDate?.get(d);
		if (!g) return { date: d, opponent: null, score: null, opp1: null, opp2: null, score1: null, score2: null };
		if (g.competitors.length < 2) {
			const c = g.competitors[0] || {};
			return {
				date: d,
				opponent: teamName(teams, c.teamId) ?? null,
				score: `${c.score ?? 0}–${0}`,
				opp1: teamName(teams, c.teamId) ?? null,
				opp2: null,
				score1: c.score ?? 0,
				score2: 0,
			};
		}
		const c1 = g.competitors[0];
		const c2 = g.competitors[1];
		const team1Id = c1.teamId;
		const team2Id = c2.teamId;
		const team1Name = teamName(teams, team1Id);
		const team2Name = teamName(teams, team2Id);
		const score1 = c1.score ?? 0;
		const score2 = c2.score ?? 0;
		let opponent = null;
		if (edge.team != null) {
			if (edge.team === team1Id) opponent = team2Name;
			else if (edge.team === team2Id) opponent = team1Name;
		}
		return {
			date: d,
			opponent,
			score: `${score1}–${score2}`,
			opp1: team1Name,
			opp2: team2Name,
			score1,
			score2,
		};
	}
</script>

{#if edge}
	<div id="edge-hud">
		<div class="hud-header">
			<div class="hud-title">
				<span class="edge-player">{edge.a}</span>
				<span class="edge-vs">vs</span>
				<span class="edge-player">{edge.b}</span>
			</div>
			<button class="btn close" onclick={onClear} aria-label="Close">×</button>
		</div>

		<div class="hud-body">
			<div class="hud-stats">
				<div class="stat">
					<span class="stat-value">{edge.w}</span>
					<span class="stat-label">shared matches</span>
				</div>
			</div>

			{#if edge.dates?.length}
				<div class="hud-section-title">Match history</div>
				<div class="hud-links">
					{#each edge.dates as d (d)}
						{@const row = gameRow(d)}
						<div class="game-row">
							<span class="game-date">{d}</span>
							<span class="game-info">
								{#if row.opp1 && row.opp2}
									<span class="game-team">{row.opp1} <span class="game-score">{row.score1}–{row.score2}</span> {row.opp2}</span>
								{:else if row.opponent}
									<span class="game-team">vs {row.opponent} <span class="game-score">{row.score}</span></span>
								{:else}
									<span class="game-team">{row.opponent ?? "match"}</span>
								{/if}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}
