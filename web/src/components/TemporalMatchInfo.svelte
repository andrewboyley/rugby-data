<script lang="ts">
  import type { DatasetLike } from "../temporal/types";
  let { dataset, matchId, onClose = () => {} }: { dataset: DatasetLike; matchId: number; onClose?: () => void } = $props();
  const match = $derived((dataset.games ?? []).find((game) => game.eventId === matchId));
  const teamName = (id: number) => { const team = dataset.teams?.[String(id)]; return typeof team === "string" ? team : team?.name ?? String(id); };
</script>
{#if match}<section class="rounded-box border border-base-300 bg-base-100/90 p-3" aria-labelledby="match-heading" data-testid="match-detail"><div class="flex items-center justify-between"><h2 id="match-heading" class="font-semibold">Match {match.eventId}</h2><button class="btn btn-ghost btn-xs" onclick={onClose}>Close</button></div><div class="mt-1 grid gap-2 sm:grid-cols-2">{#each match.competitors ?? [] as competitor}<div class="rounded-box bg-base-200 p-2"><h3 class="text-sm font-semibold">{teamName(competitor.teamId)}</h3><p class="font-mono text-lg">{competitor.score ?? "—"}</p><ul class="mt-1 text-xs">{#each competitor.roster ?? [] as entry}<li>{dataset.players?.[String(entry.playerId)] ?? entry.playerId} <span class="font-mono">#{entry.jersey ?? "—"}</span></li>{/each}</ul></div>{/each}</div></section>{/if}
