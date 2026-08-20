<script lang="ts">
import { teamName, teamAbbreviation } from "./lib.ts";
import type { GraphNode as Node, PlayerMatch, EdgeSelection as _EdgeSelection } from "./types.ts";

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
		onMatchHover = () => {},
		activeMatch = null,
		secondaryId = null,
		secondaryMatches = new Set<number>(),
	}: {
		node: Node | null | undefined;
			deg: number;
			partners: { source: { id: number; name: string; isCoach?: boolean; coachTwin?: boolean }; target: { id: number; name: string; isCoach?: boolean; coachTwin?: boolean }; w: number; dates: string[] }[];
			teams: Record<number, { name: string; color: string }>;
			onClear: () => void;
			onPartnerHover: (id: number | null) => void;
			onPartnerClick: (l: { source: { id: number }; target: { id: number } }) => void;
			hoveredTeammate: number | null;
			onTeamZoom: (tid: number) => void;
			playerMatches: PlayerMatch[];
			onMatchClick: (game: any) => void;
			onMatchHover: (nodeIds: number[] | null) => void;
			activeMatch: number | null;
			secondaryId: number | null;
			secondaryMatches: Set<number>;
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
	// Sections split by the partner's own role, not the link type: when the
	// selected node is a coach, the players they coached belong in the main
	// list, not under a "Coaches" heading.
	function isPartnerCoach(l: { source: { id: number; isCoach?: boolean; coachTwin?: boolean }; target: { id: number; isCoach?: boolean; coachTwin?: boolean } }) {
		const partner = l.source.id === node!.id ? l.target : l.source;
		return Boolean(partner.isCoach || partner.coachTwin);
	}
	function teamColor(tid: number) {
		const t = teams[tid];
		return t && typeof t === "object" && "color" in t && t.color ? (t.color as string) : null;
	}
	// Orient a player's match by the data's home/away flag: home on the left,
	// away on the right. The player's own team is highlighted on whichever side
	// it actually played.
	function matchSides(m: PlayerMatch) {
		const playerHome = m.home;
		const homeId = playerHome ? m.myTeamId : m.oppId;
		const awayId = playerHome ? m.oppId : m.myTeamId;
		return {
			home: teamAbbreviation(teams, homeId) ?? "?",
			away: teamAbbreviation(teams, awayId) ?? "?",
			homeScore: playerHome ? (m.my ?? "?") : (m.opp ?? "?"),
			awayScore: playerHome ? (m.opp ?? "?") : (m.my ?? "?"),
			homeMine: playerHome,
			awayMine: !playerHome,
			homeWin: m.winner != null && m.winner === homeId,
			awayWin: m.winner != null && m.winner === awayId,
		};
	}

	let linksEl = $state<HTMLDivElement>();
	$effect(() => {
		const id = hoveredTeammate;
		if (id == null || !linksEl) return;
		const active = linksEl.querySelector(".partner-chip.active");
		active?.scrollIntoView({ block: "nearest" });
	});

	function sharedWithSecondary(m: PlayerMatch): boolean {
		return secondaryId != null && secondaryMatches.has(m.g.eventId);
	}
	function partnerSharedWithSecondary(l: { source: { id: number }; target: { id: number } }): boolean {
		if (secondaryId == null) return true;
		return partnerId(l) === secondaryId;
	}
	const sortedMatches = $derived(
		[...playerMatches].sort(
			(a, b) => Number(sharedWithSecondary(b)) - Number(sharedWithSecondary(a)),
		),
	);
	const coachPartners = $derived.by(() => {
		const seen = new Map<string, (typeof partners)[number]>();
		for (const l of partners) {
			if (!isPartnerCoach(l)) continue;
			seen.set(partnerName(l), l);
		}
		return [...seen.values()];
	});
	const playerPartners = $derived(partners.filter((l) => !isPartnerCoach(l)));
</script>

{#if node}
	<div id="hud" class="bg-base-100/95 backdrop-blur-sm border border-base-200">
		<div class="hud-header pb-2 mb-2 border-b border-base-200">
			<div class="flex items-center space-x-3">
				<div class="flex-1">
					<div class="hud-title text-lg font-semibold">{node.name}</div>
					<div class="text-sm text-muted-foreground">
						{#if node.teams.length > 0}
							{node.teams.map((tid) => teamName(teams, tid)).slice(0, 2).join(", ")}
							{#if node.teams.length > 2}
								+{node.teams.length - 2} more
							{/if}
						{:else if node.team}
							{teamName(teams, node.team)}
						{/if}
					</div>
				</div>
				<button class="btn btn-ghost btn-square hover:bg-base-200/50" onclick={onClear} aria-label="Close">
					×
				</button>
			</div>
		</div>

		<div class="hud-body space-y-4">
			{#if node.teams.length}
				<div class="hud-teams flex flex-wrap gap-2">
					{#each node.teams as tid}
						<span
							class="team-badge flex items-center space-x-1.5 px-3 py-1.5 bg-base-200/50 border border-base-200 hover:bg-base-200/70 transition-colors"
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
							<span class="team-dot h-3 w-3"></span>
							<span class="text-sm font-medium">{teamName(teams, tid)}</span>
						</span>
					{/each}
				</div>
			{:else if node.team}
				<div
					class="hud-team flex items-center space-x-2 px-3 py-1.5 bg-base-200/50 border border-base-200 hover:bg-base-200/70 transition-colors"
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
					<span class="team-dot h-3 w-3" style="background: {teamColor(node.team!) || 'var(--muted)'}"></span>
					<span class="text-sm font-medium">{teamName(teams, node.team)}</span>
				</div>
			{/if}

			<div class="hud-stats grid grid-cols-3 gap-4 text-center pt-2 pb-2 border-t border-base-200">
				<div class="stat flex flex-col items-center">
					<span class="stat-value text-xl font-bold">{node.app}</span>
					<span class="stat-label text-xs uppercase tracking-wider">appearances</span>
				</div>
				<div class="divider h-[1px] w-full bg-base-200/50 hidden sm:block"></div>
				<div class="stat flex flex-col items-center">
					<span class="stat-value text-xl font-bold">{deg}</span>
					<span class="stat-label text-xs uppercase tracking-wider">{node.isCoach ? "players" : "teammates"}</span>
				</div>
				<div class="divider h-[1px] w-full bg-base-200/50 hidden sm:block"></div>
				<div class="stat flex flex-col items-center">
					<span class="stat-value text-xl font-bold">{partners.length}</span>
					<span class="stat-label text-xs uppercase tracking-wider">shown</span>
				</div>
			</div>

			{#if playerPartners.length}
				<div class="hud-section-title text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
					{node.isCoach ? "Players" : "Teammates"}
				</div>
				<div class="hud-links space-y-1.5" bind:this={linksEl}>
					{#each playerPartners as l (linkKey(l))}
						<div
							class="partner-chip flex items-center justify-between px-3 py-2 bg-base-50/50 border border-base-200/50 hover:bg-base-100 hover:border-base-200 transition-all duration-200 {hoveredTeammate === partnerId(l) ? 'bg-base-100 border-base-200' : ''} {secondaryId != null && !partnerSharedWithSecondary(l) ? 'opacity-40 saturate-50' : ''}"
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
							<div class="flex-1 min-w-0">
								<span class="partner-name font-medium">{partnerName(l)}</span>
							</div>
							<span class="partner-weight text-xs font-semibold bg-base-200/50 text-base-content px-2 py-0.5 rounded">{l.w}×</span>
						</div>
					{/each}
				</div>
			{/if}

			{#if coachPartners.length}
				<div class="hud-section-title text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 mt-4">
					Coaches
				</div>
				<div class="hud-links space-y-1.5">
					{#each coachPartners as l (linkKey(l))}
						<div
							class="partner-chip flex items-center justify-between px-3 py-2 border border-dashed border-base-300/70 bg-base-200/30 hover:bg-base-200/60 transition-all duration-200 {hoveredTeammate === partnerId(l) ? 'bg-base-200 border-base-300' : ''} {secondaryId != null && !partnerSharedWithSecondary(l) ? 'opacity-40 saturate-50' : ''}"
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
							<div class="flex-1 min-w-0">
								<span class="partner-name font-medium">{partnerName(l)}</span>
							</div>
							<span class="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">coach</span>
							<span class="partner-weight text-xs font-semibold bg-base-200/50 text-base-content px-2 py-0.5 rounded">{l.w}×</span>
						</div>
					{/each}
				</div>
			{/if}

			{#if playerMatches.length}
				<div class="hud-section-title text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
					Matches
				</div>
				<div class="hud-links">
					{#each sortedMatches as m (m.g.eventId)}
						{@const s = matchSides(m)}
						{@const matchNodeIds = [
							...(m.g.competitors ?? []).flatMap((c) => (c.roster ?? []).map((e) => e.playerId)),
							...(m.g.competitors ?? []).map((c) => c.coachNodeId).filter((x): x is number => x != null),
						]}
						<div
							class="game-row flex items-center px-3 py-2 bg-base-50/50 border-b border-base-200/50 hover:bg-base-100 transition-colors {activeMatch === m.g.eventId ? 'bg-base-100' : ''} {secondaryId != null && !sharedWithSecondary(m) ? 'opacity-40 saturate-50' : ''}"
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
							onmouseenter={() => onMatchHover(matchNodeIds)}
							onmouseleave={() => onMatchHover(null)}
						>
							<span class="game-date text-xs text-muted-foreground">{m.date}</span>
							<span class="game-match flex-1 flex items-center justify-between">
								<span class="game-team flex-1 text-left {s.homeMine ? 'font-semibold' : ''} {s.homeWin ? 'text-accent' : ''}">{s.home}</span>
								<span class="game-score font-bold text-xl">{s.homeScore}–{s.awayScore}</span>
								<span class="game-team flex-1 text-right {s.awayMine ? 'font-semibold' : ''} {s.awayWin ? 'text-accent' : ''}">{s.away}</span>
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}
