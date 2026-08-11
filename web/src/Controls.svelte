<script>
  let { minW = $bindable(1), maxD = $bindable(90), team = $bindable(null),
        teams = {}, maxDeg = 90 } = $props();

  const sortedTeams = $derived(
    Object.entries(teams).sort((a, b) => a[1].localeCompare(b[1])));
</script>

<div class="control">
  <label for="minw">Min shared matches</label>
  <input type="range" id="minw" min="1" max="45" bind:value={minW}>
  <span>{minW}</span>
</div>
<div class="control">
  <label for="maxd">Max degree</label>
  <input type="range" id="maxd" min="1" max={maxDeg} bind:value={maxD}>
  <span>{maxD}</span>
</div>
<div class="control">
  <label for="team">Team</label>
  <select class="team" id="team" value={team ?? ""}
    onchange={(e) => {
      team = e.currentTarget.value ? Number(e.currentTarget.value) : null;
    }}>
    <option value="">All teams</option>
    {#each sortedTeams as [tid, name]}
      <option value={tid}>{name}</option>
    {/each}
  </select>
</div>
