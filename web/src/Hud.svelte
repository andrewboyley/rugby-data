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
</script>

{#if node}
	<div id="hud">
		<div class="name">{node.name}</div>
		<div class="row">{teamName(teams, node.team)}</div>
		<div class="row">{node.app} appearances &middot; {deg} teammates</div>
		<div class="row">showing {partners.length} links</div>
		<div class="links">
			{#each partners as l (linkKey(l))}
				<div
					class="partner"
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
					{partnerName(l)} &mdash; {l.w}
				</div>
			{/each}
		</div>
		<button class="btn clear" onclick={onClear}>clear</button>
	</div>
{/if}
