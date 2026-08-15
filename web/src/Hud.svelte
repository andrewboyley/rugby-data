<script lang="ts">
	import { teamName } from "./lib.ts";
	import type { Player, PlayerMatch, EdgeSelection as _EdgeSelection } from "./types.ts";

	let {
		node,
		deg,
		partners,
		teams,
		onClear,
		onPartnerHover,
		onPartnerClick,
		hoveredTeammate = null,
		onTeamZoom = () => {},
		playerMatches = [],
		onMatchClick = () => {},
		activeMatch = null,
	}: {
		node: Player | null | undefined;
		deg: number;
		partners: { source: { id: number; name: string }; target: { id: number; name: string }; w: number }[];
		teams: Record<number, { name: string; color: string }>;
		onClear: () => void;
		onPartnerHover: (id: number | null) => void;
		onPartnerClick: (l: { source: { id: number }; target: { id: number } }) => void;
		hoveredTeammate: number | null;
		onTeamZoom: (tid: number) => void;
		playerMatches: PlayerMatch[];
		onMatchClick: (game: any) => void;
		activeMatch: number | null;
	} = $props();

	function partnerName(l: { source: { id: number; name: string }; target: { id: number; name: string } }) {
		return l.source.id === node!.id ? l.target.name : l.source.name;
	}
	function partnerId(l: { source: { id: number }; target: { id: number } }) {
		return l.source.id === node!.id ? l.target.id : l.source.id;
	}
	function linkKey(l: { source: { id: number }; target: { id: number } }) {
		return `${l.source.id}-${l.target.id}`;
	}
	function teamColor(tid: number) {
		const t = teams[tid];
		return t && typeof t === "object" && "color" in t && t.color ? (t.color as string) : null;
	}

	let linksEl = $state<HTMLDivElement>();
	$effect(() => {
		const id = hoveredTeammate;
		if (id == null || !linksEl) return;
		const active = linksEl.querySelector(".partner-chip.active");
		active?.scrollIntoView({ block: "nearest" });
	});
</script>

{#if node}
	<div id="hud">
		<div class="hud-header">
			<div class="hud-title">{node.name}</div>
			<button class="btn close" onclick={onClear} aria-label="Close">×</button>
		</div>

		<div class="hud-body">
			{#if node.teams.length}
				<div class="hud-teams">
					{#each node.teams as tid}
						<span
							class="team-badge"
							style="--team-color: {teamColor(tid) || 'var(--border)'}"
							role="button"
							tabindex="0"
							title="Zoom to {teamName(teams, tid)}"
							onclick={() => onTeamZoom(tid)}
							onkeydown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									onTeamZoom(tid);
								}
							}}
						>
							<span class="team-dot"></span>
							{teamName(teams, tid)}
						</span>
					{/each}
				</div>
			{:else if node.team}
				<div
					class="hud-team"
					role="button"
					tabindex="0"
					title="Zoom to {teamName(teams, node.team)}"
					onclick={() => onTeamZoom(node.team!)}
					onkeydown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							onTeamZoom(node.team!);
						}
					}}
				>
					<span class="team-dot" style="background: {teamColor(node.team!) || 'var(--muted)'}"></span>
					{teamName(teams, node.team)}
				</div>
			{/if}

			<div class="hud-stats">
				<div class="stat">
					<span class="stat-value">{node.app}</span>
					<span class="stat-label">appearances</span>
				</div>
				<div class="stat-divider"></div>
				<div class="stat">
					<span class="stat-value">{deg}</span>
					<span class="stat-label">teammates</span>
				</div>
				<div class="stat-divider"></div>
				<div class="stat">
					<span class="stat-value">{partners.length}</span>
					<span class="stat-label">shown</span>
				</div>
			</div>

			{#if partners.length}
				<div class="hud-section-title">Teammates</div>
				<div class="hud-links" bind:this={linksEl}>
					{#each partners as l (linkKey(l))}
						<div
							class="partner-chip {hoveredTeammate === partnerId(l) ? "active" : ""}"
							role="button"
							tabindex="0"
							onmouseenter={() => onPartnerHover?.(partnerId(l))}
							onmouseleave={() => onPartnerHover?.(null)}
							onkeydown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									onPartnerClick?.(l);
								}
							}}
							onclick={(e) => {
								e.stopPropagation();
								onPartnerClick?.(l);
							}}
						>
							<span class="partner-name">{partnerName(l)}</span>
							<span class="partner-weight">{l.w}×</span>
						</div>
					{/each}
				</div>
			{/if}

			{#if playerMatches.length}
				<div class="hud-section-title">Matches</div>
				<div class="hud-links">
					{#each playerMatches as m (m.g.eventId)}
						<div
							class="game-row {activeMatch === m.g.eventId ? "active" : ""}"
							role="button"
							tabindex="0"
							title="Show players who took part"
							onclick={() => onMatchClick(m.g)}
							onkeydown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									onMatchClick(m.g);
								}
							}}
						>
							<span class="game-date">{m.date}</span>
							<span class="game-match">
								<span class="game-team {m.myTeamId === m.winner ? "winner" : ""} mine">
									{teamName(teams, m.myTeamId)}
								</span>
								<span class="game-score">{m.my ?? "?"}–{m.opp ?? "?"}</span>
								<span class="game-team {m.oppId === m.winner ? "winner" : ""}">{teamName(teams, m.oppId)}</span>
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}
