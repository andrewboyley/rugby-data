<script lang="ts">
  import GraphControls from "./GraphControls.svelte";
  import TemporalGraph from "./TemporalGraph.svelte";
  import UnifiedSearch from "./UnifiedSearch.svelte";
  import TemporalMatchInfo from "./components/TemporalMatchInfo.svelte";
  import TemporalSelectionInfo from "./components/TemporalSelectionInfo.svelte";
  import TemporalTimelinePanel from "./components/TemporalTimelinePanel.svelte";
  import type { TimelineController } from "./TimelineController";
  import type { DatasetLike } from "./temporal/types";

  const dataset: DatasetLike = {};
  let controller = $state<TimelineController | null>(null); let time = $state(Number.NEGATIVE_INFINITY);
  let startIndex = $state(0); let endIndex = $state(0); let speed = $state(1); let playing = $state(false); let timelineOpen = $state(false);
  let autoFit = $state(true); let grid = $state(true); let trails = $state(false); let homeRequest = $state(0); let teamId = $state<number | null>(null);
  let minMatchCount = $state(1); let edgeColorMode = $state<"shared" | "winRate" | "recency">("shared"); let selectedId = $state<string | null>(null); let partnerId = $state<string | null>(null); let activeMatchId = $state<number | null>(null);
  const activeMatch = $derived((dataset?.games ?? []).find((game) => game.eventId === activeMatchId));
  const matchPlayerIds = $derived(activeMatch ? new Set(activeMatch.competitors?.flatMap((competitor) => competitor.roster?.map((entry) => String(entry.playerId)) ?? []) ?? []) : null);
  const searchNodes = $derived(Object.entries(dataset.players ?? {}).map(([id, name]) => ({ id: Number(id), name, team: null, teams: [], jersey: null, app: 0, dates: [], deg: 0, globalDeg: 0 })));
  const searchCoaches = $derived(Object.entries(dataset.coaches ?? {}).map(([id, name]) => ({ id: Number(id), name, team: null, teams: [], app: 0, dates: [], deg: 0, globalDeg: 0, isCoach: true as const })));
  const searchTeams = $derived(Object.fromEntries(Object.entries(dataset.teams ?? {}).map(([id, team]) => [Number(id), { name: typeof team === "string" ? team : team.name ?? "", color: "#64748b" }])) as unknown as Record<number, { name: string; color: string }>);
  const searchGames = $derived((dataset.games ?? []).map((game) => ({ eventId: game.eventId, date: game.date, competitors: (game.competitors ?? []).map((competitor) => ({ teamId: competitor.teamId, home: competitor.home ?? false, score: competitor.score ?? null, roster: (competitor.roster ?? []).map((entry) => ({ playerId: Number(entry.playerId), jersey: entry.jersey ?? 0 })), coach: null })), venue: null, league: null })));
  const initialPosition = "min" as const;
  function pause(): void { controller?.pause(); playing = false; }
  function togglePlayback(): void { if (!controller) return; if (controller.isPlaying()) pause(); else { const end = controller.timeline.dates[endIndex] ?? controller.timeline.dateMax; controller.play(end); playing = true; } }
  function selectPlayer(id: string | null): void { selectedId = id; partnerId = null; pause(); }
  function selectMatch(id: number): void { activeMatchId = id; const game = dataset?.games?.find((candidate) => candidate.eventId === id); const timestamp = Date.parse(game?.date ?? ""); if (controller && Number.isFinite(timestamp)) { const day = new Date(timestamp); controller.seek(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())); } pause(); }
</script>
<main class="relative h-screen overflow-hidden bg-base-100">
  <header class="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-3 bg-base-100/90 px-4 py-3 shadow-sm backdrop-blur"><h1 class="mr-auto text-lg font-semibold">Rugby co-occurrence graph</h1><UnifiedSearch nodes={searchNodes} coaches={searchCoaches} teams={searchTeams} games={searchGames} playerName={(id) => dataset.players?.[String(id)] ?? String(id)} onPickPlayer={(node) => selectPlayer(String(node.id))} onPickMatch={(game) => selectMatch(game.eventId)} onPickTeam={(id) => teamId = id} onPickVenue={() => {}} selectedId={selectedId == null ? null : Number(selectedId)} /><button class="btn btn-sm" aria-expanded={timelineOpen} disabled={(controller?.timeline.dates.length ?? 0) === 0} onclick={() => timelineOpen = !timelineOpen}>Timeline</button></header>
  <TemporalGraph {dataset} {time} {grid} {autoFit} {trails} {homeRequest} {initialPosition} filters={{ teamId, minMatchCount, edgeColorMode, selectedId, partnerId, matchPlayerIds }} onAutoFitChange={(enabled) => autoFit = enabled} onReady={(value) => { controller = value; time = value.currentTime; endIndex = Math.max(0, value.timeline.dates.length - 1); }} onTime={(value) => time = value} onPlayingChange={(value) => playing = value} onSelect={selectPlayer} />
  <div class="pointer-events-none absolute bottom-3 right-3 z-10"><GraphControls bind:autoFit bind:showGrid={grid} bind:showTrails={trails} onHome={() => homeRequest += 1} /></div>
  {#if selectedId && controller}<aside class="absolute left-4 top-20 z-20 max-w-md"><TemporalSelectionInfo {dataset} {controller} {selectedId} bind:partnerId onClear={() => { selectedId = null; partnerId = null; }} /></aside>{/if}
  {#if activeMatchId}<aside class="absolute right-4 top-20 z-10 max-w-xl"><TemporalMatchInfo {dataset} matchId={activeMatchId} onClose={() => activeMatchId = null} /></aside>{/if}
  {#if timelineOpen && controller}<TemporalTimelinePanel {dataset} {controller} {time} bind:startIndex bind:endIndex bind:speed {playing} bind:selectedId bind:teamId bind:minMatchCount bind:edgeColorMode bind:activeMatchId onToggle={togglePlayback} onPause={pause} onSeek={(index) => controller?.requestSeek(controller.timeline.dates[index] ?? Number.NEGATIVE_INFINITY)} onSelectPlayer={selectPlayer} onSelectMatch={selectMatch} />{/if}
</main>
