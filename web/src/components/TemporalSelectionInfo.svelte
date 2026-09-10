<script lang="ts">
  import type { TimelineController } from "../TimelineController";
  import type { DatasetLike } from "../temporal/types";
  let { dataset, controller, selectedId, partnerId = $bindable<string | null>(null), onClear = () => {} }: { dataset: DatasetLike; controller: TimelineController; selectedId: string; partnerId: string | null; onClear?: () => void } = $props();
  const name = $derived(dataset.players?.[selectedId] ?? selectedId);
  const partners = $derived(controller.graph.hasNode(selectedId) ? controller.graph.neighbors(selectedId).sort().slice(0, 8) : []);
  const appearances = $derived(controller.timeline.matches.filter((match) => match.players.includes(selectedId)).length);
</script>
<section class="rounded-box border border-base-300 bg-base-100/90 p-3" aria-labelledby="selected-player-heading">
  <div class="flex items-center justify-between"><h2 id="selected-player-heading" class="font-semibold">Selected player: {name}</h2></div>
  <p class="font-mono text-xs text-base-content/70">{appearances} current appearances · {partners.length} active partners</p>
  <div class="mt-2 flex flex-wrap gap-1" data-testid="partner-overlay" aria-label="Player partners"><span class="basis-full text-xs font-semibold">Partners for {selectedId}</span>{#each partners as partner}<button class="btn btn-xs" class:btn-primary={partnerId === partner} aria-label={partner} onclick={() => partnerId = partner}>{dataset.players?.[partner] ?? partner} <span class="font-mono">{controller.temporalIndex.state.edgeCounts[controller.temporalIndex.edgeIndexOf(selectedId, partner)]}</span></button>{/each}<button class="btn btn-ghost btn-xs" onclick={onClear}>Clear</button></div>
</section>
