<script lang="ts">
	import { teamName as _teamName } from "./lib.ts";
	import type { Competitor } from "./types.ts";

	let { match, teams, playerName, teamColor, onClose, onPick = () => {}, onHoverTeam = () => {}, onPlayerHover = () => {}, hoveredTeamId = null, hoveredPlayerId = null }: {
		match: {
			eventId: number;
			date: string | null;
			competitors: Array<{ teamId: number; home: boolean; score: number | null; roster: Array<{ playerId: number; jersey: number }>; coach: string | null }>;
			venue: { name: string | null; city: string | null; country: string | null } | null;
			league: { name: string; abbreviation: string | null } | null;
		} | null;
		teams: Record<number, { name: string; color: string }>;
		playerName: (id: number) => string;
		teamColor: (tid: number | null | undefined) => string;
		onClose: () => void;
		onPick: (id: number) => void;
		onHoverTeam: (teamId: number | null) => void;
		onPlayerHover: (playerId: number | null) => void;
		hoveredTeamId: number | null;
		hoveredPlayerId: number | null;
	} = $props();

	function view(m: typeof match) {
		if (!m) return null;
		const home = m.competitors.find((c: Competitor) => c.home) ?? m.competitors[0];
		const away = m.competitors.find((c: Competitor) => !c.home) ?? m.competitors[1];
		const byNumber = new Map<number, { n: number; home: number | null; away: number | null }>();
		for (const entry of home?.roster || []) {
			const j = entry.jersey;
			if (j == null) continue;
			if (!byNumber.has(j)) byNumber.set(j, { n: j, home: null, away: null });
			byNumber.get(j)!.home = entry.playerId;
		}
		for (const entry of away?.roster || []) {
			const j = entry.jersey;
			if (j == null) continue;
			if (!byNumber.has(j)) byNumber.set(j, { n: j, home: null, away: null });
			byNumber.get(j)!.away = entry.playerId;
		}
		const rows = [...byNumber.values()].sort((a, b) => a.n - b.n);
		return {
			home,
			away,
			homeScore: home?.score ?? null,
			awayScore: away?.score ?? null,
			homeWon: home?.score != null && away?.score != null && home!.score > away!.score,
			awayWon: home?.score != null && away?.score != null && away!.score > home!.score,
			rows,
		};
	}
</script>

{#if match}
	<div id="match-hud" role="dialog" aria-label="Match">
		<div class="hud-header">
			<div class="hud-title">{match.date}</div>
			{#if match.league}
				<div class="hud-meta">{match.league.name}{match.league.abbreviation ? ` (${match.league.abbreviation})` : ""}</div>
			{/if}
			{#if match.venue && (match.venue.name || match.venue.city || match.venue.country)}
				<div class="hud-meta">{[match.venue.name, match.venue.city, match.venue.country].filter(Boolean).join(", ")}</div>
			{/if}
			<button class="btn close" onclick={onClose} aria-label="Close match view">×</button>
		</div>

		<div class="hud-body">
		{#if match}
		{@const v = view(match)}
		{@const home = v!.home}
		{@const away = v!.away}
				<div class="match-board">
					<div class="match-side home" role="group" onmouseenter={() => onHoverTeam(home?.teamId ?? null)} onmouseleave={() => onHoverTeam(null)}>
						<span class="team-dot" style="background: {teamColor(home?.teamId)}"></span>
						<span class="match-team-name {v!.homeWon ? "winner" : ""} {hoveredTeamId === home?.teamId ? "team-hover" : ""}">{_teamName(teams, home?.teamId)}</span>
						{#if home?.coach}<span class="match-coach">Coach: {home.coach}</span>{/if}
					</div>
					<div class="match-score-center">
						<span class="match-score {v!.homeWon ? "lead" : ""}">{v!.homeScore ?? "–"}</span>
						<span class="match-score-sep">–</span>
						<span class="match-score {v!.awayWon ? "lead" : ""}">{v!.awayScore ?? "–"}</span>
					</div>
					<div class="match-side away" role="group" onmouseenter={() => onHoverTeam(away?.teamId ?? null)} onmouseleave={() => onHoverTeam(null)}>
						<span class="match-team-name {v!.awayWon ? "winner" : ""} {hoveredTeamId === away?.teamId ? "team-hover" : ""}">{_teamName(teams, away?.teamId)}</span>
						{#if away?.coach}<span class="match-coach">Coach: {away.coach}</span>{/if}
						<span class="team-dot" style="background: {teamColor(away?.teamId)}"></span>
					</div>
				</div>

				{#if v!.rows.length}
					<div class="match-lineup">
					{#each v!.rows as row (row.n)}
						<div class="match-lineup-row {hoveredPlayerId != null && (row.home === hoveredPlayerId || row.away === hoveredPlayerId) ? 'player-hover' : ''}">
							<span class="lineup-name-wrap">
								{#if row.home != null}
									<button class="lineup-name clickable" title="Go to {playerName(row.home)}" onclick={() => onPick(row.home!)} onmouseenter={() => onPlayerHover(row.home)} onmouseleave={() => onPlayerHover(null)}>{playerName(row.home)}</button>
								{:else}
									<span class="lineup-name empty">—</span>
								{/if}
							</span>
							<span class="lineup-jnum">{row.n}</span>
							<span class="lineup-name-wrap">
								{#if row.away != null}
									<button class="lineup-name clickable" title="Go to {playerName(row.away)}" onclick={() => onPick(row.away!)} onmouseenter={() => onPlayerHover(row.away)} onmouseleave={() => onPlayerHover(null)}>{playerName(row.away)}</button>
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

<style>
	.hud-meta {
		font-size: 0.72rem;
		opacity: 0.7;
		margin: 0.1rem 0 0;
	}
	.match-coach {
		font-size: 0.72rem;
		opacity: 0.75;
		margin-top: 0.15rem;
	}
</style>
