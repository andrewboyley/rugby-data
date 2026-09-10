<script lang="ts">
	import type { MouseEventHandler } from "svelte/elements";
	let {
		autoFit = $bindable(true),
		showGrid = $bindable(true),
		showTrails = $bindable(false),
		onFit = (() => {}) as MouseEventHandler<HTMLButtonElement>,
	} = $props();
</script>

<fieldset
	class="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-2 rounded-box border border-base-300 bg-base-100/90 p-2 shadow-lg backdrop-blur"
	aria-label="Graph view controls"
>
	<button type="button" class="btn btn-primary btn-sm" aria-label="Fit graph" onclick={onFit}>
		Fit graph
	</button>
	<label class="label cursor-pointer gap-2 py-0 text-sm">
		<span>Auto-fit</span>
		<input class="checkbox checkbox-sm" type="checkbox" bind:checked={autoFit} />
	</label>
	<label class="label cursor-pointer gap-2 py-0 text-sm">
		<span>Grid</span>
		<input class="checkbox checkbox-sm" type="checkbox" bind:checked={showGrid} />
	</label>
	<label class="label cursor-pointer gap-2 py-0 text-sm">
		<span>Trails</span>
		<input class="checkbox checkbox-sm" type="checkbox" bind:checked={showTrails} />
	</label>
</fieldset>
