<script>
	import { teamName } from "./lib.js";

	let { edge, gamesByDate, teams, onClear, onMatchClick = () => {}, activeMatch = null } = $props();

	function gameRow(d) {
		const games = gamesByDate?.get(d) || [];
		// A date can host several matches (e.g. a whole Six Nations round on one
		// day). The pair's games are the ones involving their team; prefer that
		// match over an unrelated game on the same date.
		const g =
			games.find((x) => edge.team != null && (x.competitors || []).some((c) => c.teamId === edge.team)) ||
			games[0];
		if (!g) return { date: d, home: null, away: null, score1: null, score2: null, homeMine: false, awayMine: false, homeWin: false, awayWin: false, g: null };
		const home = g.competitors.find((c) => c.home) ?? g.competitors[0];
		const away = g.competitors.find((c) => !c.home) ?? g.competitors[1];
		const score1 = home?.score ?? 0;
		const score2 = away?.score ?? 0;
		return {
			date: d,
			home: home ? teamName(teams, home.teamId) ?? null : null,
			away: away ? teamName(teams, away.teamId) ?? null : null,
			score1,
			score2,
			homeMine: home != null && edge.team != null && home.teamId === edge.team,
			awayMine: away != null && edge.team != null && away.teamId === edge.team,
			homeWin: score1 > score2,
			awayWin: score2 > score1,
			g,
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
					{#each [...edge.dates].sort().reverse() as d (d)}
						{@const row = gameRow(d)}
						<div
							class="game-row {activeMatch?.eventId === row.g?.eventId ? "active" : ""}"
							role="button"
							tabindex="0"
							title="Show players who took part"
							onclick={() => onMatchClick(row.g)}
							onkeydown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									onMatchClick(row.g);
								}
							}}
						>
							<span class="game-date">{d}</span>
							<span class="game-match">
								<span class="game-team {row.homeMine ? "mine" : ""} {row.homeWin ? "winner" : ""}">{row.home ?? "?"}</span>
								<span class="game-score">{row.score1}–{row.score2}</span>
								<span class="game-team {row.awayMine ? "mine" : ""} {row.awayWin ? "winner" : ""}">{row.away ?? "?"}</span>
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}
