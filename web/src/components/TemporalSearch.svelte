<script lang="ts">
  import type { DatasetLike } from "../temporal/types";
  let { dataset, selectedId = $bindable<string | null>(null), activeMatchId = $bindable<number | null>(null), onSelectPlayer = () => {}, onSelectMatch = () => {} }: { dataset: DatasetLike; selectedId: string | null; activeMatchId: number | null; onSelectPlayer?: (id: string) => void; onSelectMatch?: (id: number) => void } = $props();
  let playerQuery = $state("");
  let matchQuery = $state("");
  const players = $derived(Object.entries(dataset.players ?? {}).filter(([id, name]) => `${name} ${id}`.toLowerCase().includes(playerQuery.toLowerCase())).slice(0, 8));
  const matches = $derived((dataset.games ?? []).filter((game) => `${game.eventId} ${game.date ?? ""}`.toLowerCase().includes(matchQuery.toLowerCase())).slice(0, 8));
</script>

<fieldset class="flex flex-wrap items-end gap-2" aria-label="Graph search">
  <legend class="sr-only">Graph search</legend>
  <label class="form-control w-full max-w-xs"><span class="label-text text-xs">Player search</span><input class="input input-bordered input-sm" aria-label="Player search" placeholder="Name or id" bind:value={playerQuery} /></label>
  <label class="form-control w-full max-w-xs"><span class="label-text text-xs">Match search</span><input class="input input-bordered input-sm" aria-label="Match search" placeholder="Event id or date" bind:value={matchQuery} /></label>
</fieldset>
{#if playerQuery && players.length}<div class="mt-1 flex flex-wrap gap-1" aria-label="Player search results">{#each players as [id, name]}<button class="btn btn-ghost btn-xs" class:btn-primary={selectedId === id} onclick={() => onSelectPlayer(id)}>{name} <span class="font-mono">{id}</span></button>{/each}</div>{/if}
{#if matchQuery && matches.length}<div class="mt-1 flex flex-wrap gap-1" aria-label="Match search results">{#each matches as game}<button class="btn btn-ghost btn-xs" class:btn-primary={activeMatchId === game.eventId} onclick={() => onSelectMatch(game.eventId)}>Match {game.eventId}</button>{/each}</div>{/if}
