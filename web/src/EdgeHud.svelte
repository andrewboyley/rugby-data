<script lang="ts">
	import { teamName } from "./lib.ts";
	import type { EdgeSelection, Game, Competitor } from "./types.ts";

	let { edge, gamesByDate, teams, onClear, onMatchClick = () => {}, activeMatch = null }: {
		edge: EdgeSelection | null;
		gamesByDate: Map<string, Game[]>;
		teams: Record<number, { name: string; color: string }>;
		onClear: () => void;
		onMatchClick: (g: Game) => void;
		activeMatch: { eventId: number } | null;
	} = $props();

	function gameRow(d: string) {
		const games = gamesByDate?.get(d) || [];
		const g =
			games.find((x) => edge!.team != null && (x.competitors || []).some((c: Competitor) => c.teamId === edge!.team!)) ||
			games[0];
		if (!g) return { date: d, home: null as string | null, away: null as string | null, score1: null as number | null, score2: null as number | null, homeMine: false, awayMine: false, homeWin: false, awayWin: false, 			g: null as Game | null };
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
			homeMine: home != null && edge!.team != null && home.teamId === edge!.team,
			awayMine: away != null && edge!.team != null && away.teamId === edge!.team,
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
							onclick={() => onMatchClick(row.g!)}
							onkeydown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									onMatchClick(row.g!);
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
