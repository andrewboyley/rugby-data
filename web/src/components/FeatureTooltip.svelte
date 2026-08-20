<script lang="ts">
	import katex from "katex";
	import type { Snippet } from "svelte";
	import { FEATURE_LABEL, FEATURE_DETAIL, type HeuristicFeatures } from "../graph/layout-optimizer.ts";

	let {
		k,
		children,
		class: klass = "",
	}: { k: keyof HeuristicFeatures; children: Snippet; class?: string } = $props();

	let show = $state(false);
	let x = $state(0);
	let y = $state(0);

	const detail = $derived(FEATURE_DETAIL[k]);

	// Render KaTeX to the node's innerHTML (avoids {@html}). The tooltip grows to
	// fit the formula at its natural size; we only shrink it as a last resort if
	// it would exceed the viewport. The formula's intrinsic width is measured by
	// cloning it into an unconstrained box — reading the in-place element is
	// unreliable (not laid out at mount; KaTeX's .katex-display clips it).
	function fit(node: HTMLElement): void {
		const tip = node.parentElement;
		const katexEl = node.querySelector<HTMLElement>(".katex");
		if (!tip || !katexEl) return;
		katexEl.style.fontSize = "";
		const probe = katexEl.cloneNode(true) as HTMLElement;
		const holder = document.createElement("div");
		holder.style.cssText = "position:fixed;left:-99999px;top:0;width:max-content;";
		holder.appendChild(probe);
		document.body.appendChild(holder);
		const natural = probe.getBoundingClientRect().width;
		holder.remove();
		// Only scale down if the formula alone is wider than ~90% of the viewport;
		// otherwise it renders at full size and the tooltip expands to fit it.
		const avail = window.innerWidth * 0.9;
		if (natural > avail + 0.5) {
			katexEl.style.fontSize = `${(avail / natural) * 100}%`;
		}
	}

	function math(node: HTMLElement, tex: string): { update: (t: string) => void } {
		const render = (t: string) => {
			node.innerHTML = katex.renderToString(t, { throwOnError: false, displayMode: true });
			fit(node);
		};
		render(tex);
		return { update: render };
	}

	function move(e: MouseEvent) {
		x = e.clientX;
		y = e.clientY;
	}
</script>

<span
	class="relative inline-flex {klass}"
	role="tooltip"
	onmouseenter={(e) => { show = true; move(e); }}
	onmousemove={move}
	onmouseleave={() => (show = false)}
>
	{@render children()}
	{#if show}
		<span
			class="pointer-events-none fixed left-0 top-0 z-50 w-max max-w-[90vw] rounded-box border border-base-300 bg-base-200 p-3 text-left shadow-lg"
			style="transform: translate({x + 12}px, {y - 8}px) translateY(-100%);"
		>
			<div class="mb-1 text-xs font-semibold text-base-content">{FEATURE_LABEL[k]}</div>
			<div class="mb-2 overflow-hidden text-base-content" use:math={detail.latex}></div>
			<div class="max-w-64 text-[11px] leading-snug text-base-content/70">{detail.effect}</div>
		</span>
	{/if}
</span>
