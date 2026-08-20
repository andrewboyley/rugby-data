<script lang="ts">
	import { teamAbbreviation } from "./lib.ts";
	import type { Competitor } from "./types.ts";

	let { match, teams, playerName, teamColor, onClose, onPick = () => {}, onHoverTeam = () => {}, onPlayerHover = () => {}, hoveredPlayerId = null, hoveredJersey = [null, null], onJerseyHover = () => {} }: {
			match: {
				eventId: number;
				date: string | null;
				competitors: Array<{ teamId: number; home: boolean; score: number | null; roster: Array<{ playerId: number; jersey: number }>; coach: string | null; coachNodeId?: number | null }>;
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
		hoveredPlayerId: number | null;
		hoveredJersey: [number | null, number | null];
		onJerseyHover: (homeId: number | null, awayId: number | null) => void;
	} = $props();

	let hudEl = $state<HTMLDivElement | null>(null);

	// Keep the hover-highlighted row in view: when a player is hovered via the
	// graph, bring their roster row (and only that half of the row) into view
	// if it has scrolled out of the panel.
	$effect(() => {
		const id = hoveredPlayerId;
		if (id == null || !hudEl) return;
		hudEl.querySelector<HTMLElement>(`[data-player-id="${id}"]`)?.scrollIntoView({
			block: "nearest",
		});
	});

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
		const rows = [...byNumber.values()].sort((a, b) => a.n - b.n).filter((r) => r.home != null || r.away != null);
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
	<div id="match-hud" role="dialog" aria-label="Match" class="bg-base-100/95 backdrop-blur-sm border border-base-200" bind:this={hudEl}>
		<div class="hud-header pb-2 mb-2 border-b border-base-200">
			<div class="hud-title">{match.date}</div>
			<button class="btn btn-ghost btn-square hover:bg-base-200/50 absolute top-2 right-2" onclick={onClose} aria-label="Close match view">
				×
			</button>
			<div class="hud-meta flex flex-col gap-0.5 text-xs text-muted-foreground mt-1">
				{#if match.venue && (match.venue.name || match.venue.city || match.venue.country)}
					<span>{[match.venue.name, match.venue.city, match.venue.country].filter(Boolean).join(", ")}</span>
				{/if}
				{#if match.league}
					<span>{match.league.name}{match.league.abbreviation ? ` (${match.league.abbreviation})` : ""}</span>
				{/if}
			</div>
		</div>

		<div class="hud-body">
		{#if match}
		{@const v = view(match)}
		{@const home = v!.home}
		{@const away = v!.away}
				<div class="match-board grid grid-cols-[1fr_auto_1fr] gap-4 items-center px-4 py-3 bg-base-50/50 border border-base-200 rounded-lg">
					<div class="match-side home flex items-center space-x-3" role="group" onmouseenter={() => onHoverTeam(home?.teamId ?? null)} onmouseleave={() => onHoverTeam(null)}>
						<span class="team-dot h-3 w-3" style="background: {teamColor(home?.teamId)}"></span>
						<span class="match-team-name text-base font-semibold {v!.homeWon ? 'text-accent' : ''}">{teamAbbreviation(teams, home?.teamId)}</span>
					</div>
					<div class="match-score-center flex flex-row items-center justify-center gap-2">
						<span class="match-score text-2xl font-bold {v!.homeWon ? 'text-accent' : ''}">{v!.homeScore ?? "–"}</span>
						<span class="match-score-sep text-muted-foreground">–</span>
						<span class="match-score text-2xl font-bold {v!.awayWon ? 'text-accent' : ''}">{v!.awayScore ?? "–"}</span>
					</div>
					<div class="match-side away flex items-center space-x-3 justify-end" role="group" onmouseenter={() => onHoverTeam(away?.teamId ?? null)} onmouseleave={() => onHoverTeam(null)}>
						<span class="match-team-name text-base font-semibold {v!.awayWon ? 'text-accent' : ''}">{teamAbbreviation(teams, away?.teamId)}</span>
						<span class="team-dot h-3 w-3" style="background: {teamColor(away?.teamId)}"></span>
					</div>
				</div>

				<div class="match-coaches mt-3">
					<div
						class="match-lineup-row bg-base-50/50 hover:bg-base-100 transition-colors duration-200"
						class:row-player-home={hoveredPlayerId != null && home?.coachNodeId != null && hoveredPlayerId === home.coachNodeId}
						class:row-player-away={hoveredPlayerId != null && away?.coachNodeId != null && hoveredPlayerId === away.coachNodeId}
					>
						<span class="lineup-name-wrap text-right" role="presentation"
							onmouseenter={() => home?.coachNodeId != null && onPlayerHover(home.coachNodeId)}
							onmouseleave={() => onPlayerHover(null)}>
							{#if home?.coach != null}
								<button class="lineup-name clickable w-full text-left font-medium"
									title="Go to {home.coach}"
									onclick={() => home.coachNodeId != null && onPick(home.coachNodeId)}>
									{home.coach}
								</button>
							{/if}
						</span>
						<span class="lineup-coach-label" aria-hidden="true">coach</span>
						<span class="lineup-name-wrap text-left" role="presentation"
							onmouseenter={() => away?.coachNodeId != null && onPlayerHover(away.coachNodeId)}
							onmouseleave={() => onPlayerHover(null)}>
							{#if away?.coach != null}
								<button class="lineup-name clickable w-full text-right font-medium"
									title="Go to {away.coach}"
									onclick={() => away.coachNodeId != null && onPick(away.coachNodeId)}>
									{away.coach}
								</button>
							{/if}
						</span>
					</div>
				</div>

				{#if v!.rows.length}
					<div class="match-lineup mt-4">
						{#each v!.rows as row (row.n)}
						{@const rowJersey = (row.home != null && hoveredJersey.includes(row.home)) || (row.away != null && hoveredJersey.includes(row.away))}
<div class="match-lineup-row grid grid-cols-[1fr_36px_1fr] bg-base-50/50 hover:bg-base-100 transition-colors duration-200"
							class:row-jersey-hover={rowJersey}
							class:row-player-home={hoveredPlayerId != null && row.home === hoveredPlayerId}
							class:row-player-away={hoveredPlayerId != null && row.away === hoveredPlayerId}>
						<span class="lineup-name-wrap text-right" role="presentation"
							onmouseenter={() => row.home != null && onPlayerHover(row.home)}
							onmouseleave={() => onPlayerHover(null)}>
							{#if row.home != null}
								<button class="lineup-name clickable w-full text-left font-medium"
									data-player-id={row.home}
									title="Go to {playerName(row.home)}"
									onclick={() => onPick(row.home!)}>
									{playerName(row.home)}
								</button>
							{/if}
						</span>
						<span class="lineup-jnum" role="button"
							tabindex="0"
							aria-label="Highlight jersey number {row.n} across both teams"
							onmouseenter={() => onJerseyHover(row.home, row.away)}
							onmouseleave={() => onJerseyHover(null, null)}>{row.n}</span>
						<span class="lineup-name-wrap text-left" role="presentation"
							onmouseenter={() => row.away != null && onPlayerHover(row.away)}
							onmouseleave={() => onPlayerHover(null)}>
							{#if row.away != null}
								<button class="lineup-name clickable w-full text-right font-medium"
									data-player-id={row.away}
									title="Go to {playerName(row.away)}"
									onclick={() => onPick(row.away!)}>
									{playerName(row.away)}
								</button>
							{/if}
						</span>
					</div>
					{/each}
					</div>
				{/if}

				<div class="match-hint mt-3 text-xs text-muted-foreground text-center">
					Click a player to focus their node. Close to return to the filtered graph.
				</div>
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
</style>
