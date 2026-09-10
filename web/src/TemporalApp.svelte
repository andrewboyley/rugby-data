<script lang="ts">
  import { onMount } from "svelte";
  import GraphControls from "./GraphControls.svelte";
  import TemporalGraph from "./TemporalGraph.svelte";
  import TemporalMatchInfo from "./components/TemporalMatchInfo.svelte";
  import TemporalSearch from "./components/TemporalSearch.svelte";
  import TemporalSelectionInfo from "./components/TemporalSelectionInfo.svelte";
  import TemporalTimelinePanel from "./components/TemporalTimelinePanel.svelte";
  import type { TimelineController } from "./TimelineController";
  import type { DatasetLike } from "./temporal/types";

  let dataset = $state<DatasetLike | null>(null); let controller = $state<TimelineController | null>(null); let time = $state(Number.NEGATIVE_INFINITY);
  let startIndex = $state(0); let endIndex = $state(0); let speed = $state(1); let playing = $state(false); let timelineOpen = $state(false);
  let autoFit = $state(true); let grid = $state(true); let trails = $state(false); let fitRequest = $state(0); let teamId = $state<number | null>(null);
  let minMatchCount = $state(1); let edgeColorMode = $state<"shared" | "winRate" | "recency">("shared"); let selectedId = $state<string | null>(null); let partnerId = $state<string | null>(null); let activeMatchId = $state<number | null>(null); let loadError = $state<string | null>(null);
  const activeMatch = $derived((dataset?.games ?? []).find((game) => game.eventId === activeMatchId));
  const matchPlayerIds = $derived(activeMatch ? new Set(activeMatch.competitors?.flatMap((competitor) => competitor.roster?.map((entry) => String(entry.playerId)) ?? []) ?? []) : null);
  const initialPosition = "max" as const;
  onMount(async () => { try { const response = await fetch("/data/dataset.json"); if (!response.ok) throw new Error(`dataset.json: ${response.status}`); dataset = await response.json(); } catch (error) { loadError = error instanceof Error ? error.message : String(error); } });
  function pause(): void { controller?.pause(); playing = false; }
  function togglePlayback(): void { if (!controller) return; if (controller.isPlaying()) pause(); else { const end = controller.timeline.dates[endIndex] ?? controller.timeline.dateMax; controller.play(end); playing = true; } }
  function selectPlayer(id: string | null): void { selectedId = id; partnerId = null; pause(); }
  function selectMatch(id: number): void { activeMatchId = id; const game = dataset?.games?.find((candidate) => candidate.eventId === id); const timestamp = Date.parse(game?.date ?? ""); if (controller && Number.isFinite(timestamp)) { const day = new Date(timestamp); controller.seek(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())); } pause(); }
</script>
<main class="relative h-screen overflow-hidden bg-base-100">
  <header class="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-3 bg-base-100/90 px-4 py-3 shadow-sm backdrop-blur"><h1 class="mr-auto text-lg font-semibold">Rugby co-occurrence graph</h1>{#if dataset}<TemporalSearch {dataset} bind:selectedId bind:activeMatchId onSelectPlayer={selectPlayer} onSelectMatch={selectMatch} />{/if}<button class="btn btn-sm" aria-expanded={timelineOpen} onclick={() => timelineOpen = !timelineOpen}>Timeline</button></header>
  {#if dataset}<TemporalGraph {dataset} {time} {grid} {autoFit} {trails} {fitRequest} {initialPosition} filters={{ teamId, minMatchCount, edgeColorMode, selectedId, partnerId, matchPlayerIds }} onAutoFitChange={(enabled) => autoFit = enabled} onReady={(value) => { controller = value; time = value.currentTime; endIndex = Math.max(0, value.timeline.dates.length - 1); }} onTime={(value) => time = value} onPlayingChange={(value) => playing = value} onSelect={selectPlayer} />{:else if loadError}<p class="p-6">Could not load temporal dataset: {loadError}</p>{:else}<p class="p-6">Loading dataset...</p>{/if}
  <div class="pointer-events-none absolute bottom-3 right-3 z-10"><GraphControls bind:autoFit bind:showGrid={grid} bind:showTrails={trails} onFit={() => { autoFit = true; fitRequest += 1; }} /></div>
  {#if selectedId && controller && dataset}<aside class="absolute left-4 top-20 z-20 max-w-md"><TemporalSelectionInfo {dataset} {controller} {selectedId} bind:partnerId onClear={() => { selectedId = null; partnerId = null; }} /></aside>{/if}
  {#if activeMatchId && dataset}<aside class="absolute right-4 top-20 z-10 max-w-xl"><TemporalMatchInfo {dataset} matchId={activeMatchId} onClose={() => activeMatchId = null} /></aside>{/if}
  {#if timelineOpen && controller && dataset}<TemporalTimelinePanel {dataset} {controller} {time} bind:startIndex bind:endIndex bind:speed {playing} bind:selectedId bind:teamId bind:minMatchCount bind:edgeColorMode bind:activeMatchId onToggle={togglePlayback} onPause={pause} onSeek={(index) => controller?.requestSeek(controller.timeline.dates[index] ?? Number.NEGATIVE_INFINITY)} onSelectPlayer={selectPlayer} onSelectMatch={selectMatch} />{/if}
</main>
