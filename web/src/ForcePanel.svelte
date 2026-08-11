<script>
  const DEFAULTS = { dist: 120, str: 40, chg: -600, coll: 8, decay: 20 };

  let { params, show, onApply } = $props();

  let draft = $state({ ...DEFAULTS });

  $effect(() => {
    if (show) {
      draft = {
        dist: params.dist,
        str: params.str * 100,
        chg: params.chg,
        coll: params.coll,
        decay: params.decay * 1000,
      };
    }
  });

  function apply() {
    onApply({
      dist: draft.dist,
      str: draft.str / 100,
      chg: draft.chg,
      coll: draft.coll,
      decay: draft.decay / 1000,
    });
  }
  function reset() {
    draft = { ...DEFAULTS };
    onApply({ dist: 120, str: 0.4, chg: -600, coll: 8, decay: 0.02 });
  }
</script>

{#if show}
  <div id="params">
    <div class="prow">
      <div class="control">
        <label>Link distance</label>
        <input type="range" min="10" max="200" bind:value={draft.dist}>
        <span>{draft.dist}</span>
      </div>
      <div class="control">
        <label>Link strength</label>
        <input type="range" min="0" max="100" bind:value={draft.str}>
        <span>{draft.str}</span>
      </div>
      <div class="control">
        <label>Charge</label>
        <input type="range" min="-1000" max="-20"
          step="10" bind:value={draft.chg}>
        <span>{draft.chg}</span>
      </div>
      <div class="control">
        <label>Collide</label>
        <input type="range" min="0" max="30" bind:value={draft.coll}>
        <span>{draft.coll}</span>
      </div>
      <div class="control">
        <label>Alpha decay</label>
        <input type="range" min="1" max="200" bind:value={draft.decay}>
        <span>{draft.decay}</span>
      </div>
      <button class="btn" onclick={apply}>Apply</button>
      <button class="btn" onclick={reset}>Reset</button>
    </div>
  </div>
{/if}
