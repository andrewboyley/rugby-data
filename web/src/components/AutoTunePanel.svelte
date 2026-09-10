<script lang="ts">
  import ScorePlot, { type PlotSeries } from "../ScorePlot.svelte";
  import type { BanditSnapshot } from "../graph/rl-bandit";
  import type { TrainingSessionSnapshot } from "../graph/training-session";
  import { optimizerState } from "../stores/optimizer-store.svelte";

  interface Props {
    running: boolean;
    snapshot: TrainingSessionSnapshot;
    bandit: BanditSnapshot | null;
    onToggle: () => void;
    onTrainingPause: () => void;
    onHorizonChange: () => void;
    onResetPolicy: () => void;
  }

  let { running, snapshot, bandit, onToggle, onTrainingPause, onHorizonChange, onResetPolicy }: Props = $props();
  let confirmOpen = $state(false);
  let advancedOpen = $state(false);
  let resetButton: HTMLButtonElement | null = null;
  let dialog: HTMLDialogElement | null = null;

  const series = $derived<PlotSeries[]>([
    { label: "trial score", data: optimizerState.episodeMeans, color: "#f59f00", width: 2 },
  ]);
  const scoredRewards = $derived(snapshot.recentRewards);
  const bestReward = $derived(scoredRewards.length ? Math.max(...scoredRewards) : null);
  const averageReward = $derived(scoredRewards.length ? scoredRewards.reduce((sum, reward) => sum + reward, 0) / scoredRewards.length : null);
  const phase = $derived(!snapshot.autoTune.enabled ? "Ready" : optimizerState.calibrationSteps < 60 ? "Calibrating" : running ? "Evaluating candidate settings" : "Ready");
  const executionLabel = $derived(snapshot.execution.state === "active" ? "Running" : snapshot.execution.state === "paused" ? "Paused" : "Stopped");

  function formatScore(value: number | null): string {
    return value === null || !Number.isFinite(value) ? "—" : value.toFixed(3);
  }

  function openConfirmation(): void {
    confirmOpen = true;
    dialog?.showModal();
  }

  function closeConfirmation(): void {
    confirmOpen = false;
    dialog?.close();
    requestAnimationFrame(() => resetButton?.focus());
  }

  function confirmReset(): void {
    onResetPolicy();
    closeConfirmation();
  }
</script>

<section aria-labelledby="autotune-heading" class="space-y-3">
  <div class="flex flex-wrap items-start justify-between gap-2">
    <div>
      <h2 id="autotune-heading" class="text-sm font-semibold">Auto-tune diagnostics</h2>
      <p class="text-xs opacity-70">Training evidence stays separate from Live View.</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <button data-testid="autotune-toggle" class="btn btn-sm btn-primary" onclick={onToggle}>
        {optimizerState.autoTune ? "Disable Auto-tune" : "Enable Auto-tune"}
      </button>
      <button bind:this={resetButton} class="btn btn-sm btn-ghost" onclick={openConfirmation}>Reset learned policy</button>
    </div>
  </div>

  <p data-testid="autotune-state" aria-live="polite" class="rounded border border-base-300 bg-base-100 p-2 font-mono text-xs">
    Phase: {phase} · Execution: {executionLabel} · Calibration: {optimizerState.calibrationSteps}/60 · Trials: {bandit?.leaderboard.length ?? 0}. Calibrating: {optimizerState.calibrationSteps}/60 steps. {bandit?.leaderboard.length ?? 0} scored trials.
  </p>

  <fieldset class="grid gap-2 sm:grid-cols-2">
    <legend class="sr-only">Training controls</legend>
    <label class="label min-w-0 text-xs">
      <span>Iterations per trial</span>
      <input data-testid="episode-length" class="range range-xs w-full" type="range" min="1" max="500" step="1" bind:value={optimizerState.episodeLength} onchange={onHorizonChange} />
      <span class="font-mono">{optimizerState.episodeLength}</span>
    </label>
    <div class="flex items-end gap-2">
      <button data-testid="training-pause" class="btn btn-sm btn-outline" disabled={!optimizerState.autoTune || snapshot.execution.state === "idle"} onclick={onTrainingPause}>
        {snapshot.execution.state === "active" ? "Pause Training" : "Resume Training"}
      </button>
      <span aria-live="polite" class="pb-2 text-xs opacity-70">Live View is independent</span>
    </div>
  </fieldset>

  <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
    <div class="stat rounded border border-base-300 bg-base-100 p-2"><div class="stat-title text-xs">Current reward</div><div class="stat-value font-mono text-lg">{formatScore(snapshot.latestReward)}</div></div>
    <div class="stat rounded border border-base-300 bg-base-100 p-2"><div class="stat-title text-xs">Best reward</div><div class="stat-value font-mono text-lg">{formatScore(bestReward)}</div></div>
    <div class="stat rounded border border-base-300 bg-base-100 p-2"><div class="stat-title text-xs">Average reward</div><div class="stat-value font-mono text-lg">{formatScore(averageReward)}</div></div>
    <div class="stat rounded border border-base-300 bg-base-100 p-2"><div class="stat-title text-xs">Exploration / exploitation</div><div class="stat-value font-mono text-lg">{bandit ? `${bandit.explorationPct.toFixed(0)} / ${bandit.exploitationPct.toFixed(0)}%` : "—"}</div></div>
  </div>

  {#if snapshot.latestReward === null}
    <p class="border border-dashed border-base-300 p-2 text-xs" aria-live="polite">No scored reward yet. Calibration rewards are intentionally not scored.</p>
  {/if}

  <div class="grid gap-2 sm:grid-cols-2">
    <div class="rounded border border-base-300 p-2 text-xs"><h3 class="font-semibold">Current candidate</h3><p class="mt-1 font-mono break-words">{bandit ? JSON.stringify(bandit.currentParams) : "Waiting for a candidate"}</p></div>
    <div class="rounded border border-base-300 p-2 text-xs"><h3 class="font-semibold">Applied to Live View</h3>{#if snapshot.strictBestApplication}<p class="mt-1 font-mono">#{snapshot.strictBestApplication.sequence} · reward {formatScore(snapshot.strictBestApplication.reward)}</p><p class="font-mono text-[0.65rem]">{snapshot.strictBestApplication.timestamp}</p><p class="mt-1">Settings applied: <span class="font-mono">{JSON.stringify(snapshot.strictBestApplication.appliedSettings)}</span></p><p class="font-mono">Changed: {snapshot.strictBestApplication.settingsChangeSummary.length ? snapshot.strictBestApplication.settingsChangeSummary.join(", ") : "none"}</p>{:else}<p class="mt-1 opacity-70">No strict-best candidate applied yet.</p>{/if}</div>
  </div>

  <section>
    <button type="button" class="btn btn-sm btn-ghost w-full justify-start focus-visible:outline-2" aria-expanded={advancedOpen} onclick={() => advancedOpen = !advancedOpen}>Advanced diagnostics</button>
    {#if advancedOpen}
    <div class="mt-2 grid gap-3 border-l-2 border-base-300 pl-3 text-xs">
      <section aria-labelledby="dimension-heading"><h3 id="dimension-heading" class="font-semibold">Per-dimension evidence</h3>{#if bandit?.dims.length}<ul class="mt-1 grid gap-1 sm:grid-cols-2">{#each bandit.dims as dimension}<li class="font-mono">{dimension.label}: current {dimension.currentLevel}, best {dimension.bestLevel}</li>{/each}</ul>{:else}<p class="opacity-70">No unlocked dimensions yet.</p>{/if}</section>
      <section aria-labelledby="history-heading"><h3 id="history-heading" class="font-semibold">Leaderboard and history</h3><div class="mt-1 max-h-32 overflow-auto">{#if bandit?.leaderboard.length}<ol class="font-mono">{#each bandit.leaderboard.slice(-10).reverse() as entry}<li>Trial {entry.episode}: {formatScore(entry.reward)}</li>{/each}</ol>{:else}<p class="opacity-70">No scored trials yet.</p>{/if}</div></section>
      <section aria-labelledby="plot-heading"><h3 id="plot-heading" class="font-semibold">Score plot</h3>{#if scoredRewards.length}<ScorePlot {series}/>{:else}<p class="mt-1 opacity-70">The plot will appear after the first finite reward.</p>{/if}</section>
      <section aria-labelledby="interpretation-heading"><h3 id="interpretation-heading" class="font-semibold">Reward and calibration interpretation</h3><p class="mt-1">Calibration establishes the reward baseline. Only finite completed trial rewards enter the leaderboard; strict-best applies only when a candidate is strictly better.</p></section>
    </div>
    {/if}
  </section>
</section>

<dialog bind:this={dialog} aria-labelledby="reset-title" class="rounded-box bg-base-100 p-0 text-base-content" onclose={() => { if (confirmOpen) confirmOpen = false; }}>
  <form method="dialog" class="w-[min(28rem,calc(100vw-2rem))] space-y-3 p-4" onsubmit={(event) => event.preventDefault()}>
    <h2 id="reset-title" class="text-base font-semibold">Reset learned policy?</h2>
    <p class="text-sm">This stops training, restores the initial policy, and clears learned reward history. Live graph-generation inputs remain unchanged.</p>
    <div class="flex justify-end gap-2"><button class="btn btn-sm btn-ghost" type="button" onclick={closeConfirmation}>Cancel</button><button class="btn btn-sm btn-error" type="button" onclick={confirmReset}>Confirm reset</button></div>
  </form>
</dialog>
