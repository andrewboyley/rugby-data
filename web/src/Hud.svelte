<script>
	import { teamName } from "./lib.js";

	let { node, deg, partners, teams, onClear, onPartnerHover, onPartnerClick } = $props();

	function partnerName(l) {
		return l.source.id === node.id ? l.target.name : l.source.name;
	}
	function partnerId(l) {
		return l.source.id === node.id ? l.target.id : l.source.id;
	}
	function linkKey(l) {
		return `${l.source.id}-${l.target.id}`;
	}
	function teamColor(tid) {
		const t = teams[tid];
		return t && typeof t === "object" && t.color ? t.color : null;
	}
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
						<span class="team-badge" style="--team-color: {teamColor(tid) || 'var(--border)'}">
							<span class="team-dot"></span>
							{teamName(teams, tid)}
						</span>
					{/each}
				</div>
			{:else if node.team}
				<div class="hud-team">
					<span class="team-dot" style="background: {teamColor(node.team) || 'var(--muted)'}"></span>
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
				<div class="hud-links">
					{#each partners as l (linkKey(l))}
						<div
							class="partner-chip"
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
		</div>
	</div>
{/if}
