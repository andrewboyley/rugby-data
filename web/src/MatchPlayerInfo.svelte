<script lang="ts">
	import { teamName, teamAbbreviation, JERSEY_COLORS } from "./lib.ts";
	import type { Game, Competitor, RawTeamInfo } from "./types.ts";

	let {
		match,
		playerId,
		playerName,
		teams,
		teamColor,
		onGoToGraph,
		onClose = () => {},
	}: {
		match: Game;
		playerId: number;
		playerName: (id: number) => string;
		teams: Record<number, RawTeamInfo>;
		teamColor: (tid: number | null | undefined) => string;
		onGoToGraph: () => void;
		onClose: () => void;
	} = $props();

	const side = $derived(
		(match.competitors ?? []).find(
			(c: Competitor) =>
				(c.roster ?? []).some((e) => e.playerId === playerId) || c.coachNodeId === playerId,
		) ?? null,
	);
	const isCoach = $derived(side != null && side.coachNodeId === playerId);
	const entry = $derived(side?.roster.find((e) => e.playerId === playerId) ?? null);
	const teamId = $derived(side?.teamId ?? null);
	const name = $derived(isCoach ? (side?.coach ?? "") : playerName(playerId));
	const jersey = $derived(entry?.jersey ?? null);
	const home = $derived(Boolean(side?.home));
	const opp = $derived((match.competitors ?? []).find((c: Competitor) => c !== side) ?? null);
	const myScore = $derived(side?.score ?? null);
	const oppScore = $derived(opp?.score ?? null);
	const result = $derived(
		myScore != null && oppScore != null
			? myScore > oppScore
				? "W"
				: myScore === oppScore
					? "D"
					: "L"
			: null,
	);

	function positionOf(j: number | null): string {
		if (j == null) return "coach";
		if (j <= 3) return "front row";
		if (j <= 8) return "back row";
		if (j <= 15) return "fullback";
		return "bench";
	}

	const homeComp = $derived((match.competitors ?? []).find((c: Competitor) => c.home) ?? null);
	const awayComp = $derived((match.competitors ?? []).find((c: Competitor) => !c.home) ?? null);
	const homeAbbr = $derived(homeComp ? teamAbbreviation(teams, homeComp.teamId) : "?");
	const awayAbbr = $derived(awayComp ? teamAbbreviation(teams, awayComp.teamId) : "?");
	const homeScore = $derived(homeComp?.score ?? "?");
	const awayScore = $derived(awayComp?.score ?? "?");
	const jerseyColor = $derived(
		jersey == null || jersey < 1 || jersey > 23 ? "#8e8e93" : JERSEY_COLORS[jersey - 1],
	);
</script>

<div id="match-player-info" class="bg-base-100/95 backdrop-blur-sm border border-base-200">
	<div class="hud-header pb-2 mb-2 border-b border-base-200">
		<div class="flex items-center space-x-3">
			<div class="flex-1 min-w-0">
				<div class="hud-title text-lg font-semibold">{name || "?"}</div>
				<div class="text-sm text-muted-foreground">
					{teamId != null ? teamName(teams, teamId) : "–"}
				</div>
			</div>
			<button class="btn btn-ghost btn-square hover:bg-base-200/50" onclick={onClose} aria-label="Close player info">
				×
			</button>
		</div>
	</div>

	<div class="hud-body space-y-4">
		{#if teamId != null}
			<div
				class="hud-team flex items-center space-x-2 px-3 py-1.5 bg-base-200/50 border border-base-200"
				role="group"
			>
				<span class="team-dot h-3 w-3" style="background: {teamColor(teamId)}"></span>
				<span class="text-sm font-medium">{teamName(teams, teamId)}</span>
				<span class="text-[10px] uppercase tracking-wider text-muted-foreground ml-auto">
					{home ? "home" : "away"}
				</span>
			</div>
		{/if}

		<div class="hud-stats grid grid-cols-3 gap-4 text-center pt-2 pb-2 border-t border-base-200">
			<div class="stat flex flex-col items-center">
				{#if isCoach}
					<span class="stat-value text-xl font-bold">{teamAbbreviation(teams, teamId) || "?"}</span>
					<span class="stat-label text-xs uppercase tracking-wider">team</span>
				{:else}
					<span class="stat-value text-xl font-bold" style="color: {jerseyColor}">{jersey ?? "–"}</span>
					<span class="stat-label text-xs uppercase tracking-wider">jersey</span>
				{/if}
			</div>
			<div class="divider h-[1px] w-full bg-base-200/50 hidden sm:block"></div>
			<div class="stat flex flex-col items-center">
				<span class="stat-value text-xl font-bold">{positionOf(jersey)}</span>
				<span class="stat-label text-xs uppercase tracking-wider">{isCoach ? "role" : "position"}</span>
			</div>
			<div class="divider h-[1px] w-full bg-base-200/50 hidden sm:block"></div>
			<div class="stat flex flex-col items-center">
				<span class="stat-value text-xl font-bold {result === "W" ? 'text-accent' : ''}">{result ?? "–"}</span>
				<span class="stat-label text-xs uppercase tracking-wider">result</span>
			</div>
		</div>

		<div class="match-result flex items-center justify-between px-3 py-2 bg-base-50/50 border border-base-200 rounded-lg">
			<span class="text-sm font-semibold">{homeAbbr}</span>
			<span class="font-bold text-lg">{homeScore}–{awayScore}</span>
			<span class="text-sm font-semibold">{awayAbbr}</span>
		</div>

		<button class="btn btn-primary btn-sm w-full" onclick={onGoToGraph} type="button">
			Open in graph
		</button>
		<p class="text-[11px] text-muted-foreground text-center">
			Closes the match view and opens this {isCoach ? "coach" : "player"}'s node in the global graph.
		</p>
	</div>
</div>
