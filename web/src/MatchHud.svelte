<script>
	import { teamName } from "./lib.js";

	let { match, teams, playerName, teamColor, onClose, onPick = () => {} } = $props();

	// Merge both rosters by jersey number: each row shows the home and away
	// player wearing the same number, with a single centre jersey column. Uses
	// the jersey worn in this match (not the player's most common one).
	function view(m) {
		if (!m) return null;
		const home = m.competitors.find((c) => c.home) ?? m.competitors[0];
		const away = m.competitors.find((c) => !c.home) ?? m.competitors[1];
		const byNumber = new Map();
		for (const entry of home?.roster || []) {
			const j = entry.jersey;
			if (j == null) continue;
			if (!byNumber.has(j)) byNumber.set(j, { n: j, home: null, away: null });
			byNumber.get(j).home = entry.playerId;
		}
		for (const entry of away?.roster || []) {
			const j = entry.jersey;
			if (j == null) continue;
			if (!byNumber.has(j)) byNumber.set(j, { n: j, home: null, away: null });
			byNumber.get(j).away = entry.playerId;
		}
		const rows = [...byNumber.values()].sort((a, b) => a.n - b.n);
		return {
			home,
			away,
			homeScore: home?.score ?? null,
			awayScore: away?.score ?? null,
			homeWon: home?.score != null && away?.score != null && home.score > away.score,
			awayWon: home?.score != null && away?.score != null && away.score > home.score,
			rows,
		};
	}
</script>

{#if match}
	<div id="match-hud" role="dialog" aria-label="Match">
		<div class="hud-header">
			<div class="hud-title">{match.date}</div>
			<button class="btn close" onclick={onClose} aria-label="Close match view">×</button>
		</div>

		<div class="hud-body">
			{#if match}
				{@const v = view(match)}
				{@const home = v.home}
				{@const away = v.away}
				<div class="match-board">
					<div class="match-side home">
						<span class="team-dot" style="background: {teamColor(home?.teamId)}"></span>
						<span class="match-team-name {v.homeWon ? "winner" : ""}">{teamName(teams, home?.teamId)}</span>
					</div>
					<div class="match-score-center">
						<span class="match-score {v.homeWon ? "lead" : ""}">{v.homeScore ?? "–"}</span>
						<span class="match-score-sep">–</span>
						<span class="match-score {v.awayWon ? "lead" : ""}">{v.awayScore ?? "–"}</span>
					</div>
					<div class="match-side away">
						<span class="match-team-name {v.awayWon ? "winner" : ""}">{teamName(teams, away?.teamId)}</span>
						<span class="team-dot" style="background: {teamColor(away?.teamId)}"></span>
					</div>
				</div>

				{#if v.rows.length}
					<div class="match-lineup">
						{#each v.rows as row (row.n)}
							<div class="match-lineup-row">
								<span class="lineup-name-wrap">
									{#if row.home != null}
										<button class="lineup-name clickable" title="Go to {playerName(row.home)}" onclick={() => onPick(row.home)}>{playerName(row.home)}</button>
									{:else}
										<span class="lineup-name empty">—</span>
									{/if}
								</span>
								<span class="lineup-jnum">{row.n}</span>
								<span class="lineup-name-wrap">
									{#if row.away != null}
										<button class="lineup-name clickable" title="Go to {playerName(row.away)}" onclick={() => onPick(row.away)}>{playerName(row.away)}</button>
									{:else}
										<span class="lineup-name empty">—</span>
									{/if}
								</span>
							</div>
						{/each}
					</div>
				{/if}

				<div class="match-hint">Click a player to focus their node. Close to return to the filtered graph.</div>
			{/if}
		</div>
	</div>
{/if}