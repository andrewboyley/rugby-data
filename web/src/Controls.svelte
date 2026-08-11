<script>
  let { minW = $bindable(1), maxD = $bindable(90), team = $bindable(null),
        dateStart = $bindable(null), dateEnd = $bindable(null),
        teams = {}, maxDeg = 90 } = $props();

  const sortedTeams = $derived(
    Object.entries(teams).sort((a, b) => a[1].localeCompare(b[1])));

  let teamSel = $state(team == null ? "" : String(team));
  let ds = $state(dateStart ?? "");
  let de = $state(dateEnd ?? "");

  $effect(() => {
    team = teamSel === "" ? null : Number(teamSel);
  });
  $effect(() => {
    const want = team == null ? "" : String(team);
    if (teamSel !== want) teamSel = want;
  });
  $effect(() => {
    ds = dateStart ?? "";
  });
  $effect(() => {
    de = dateEnd ?? "";
  });
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
  <select class="team" id="team" bind:value={teamSel}>
    <option value="">All teams</option>
    {#each sortedTeams as [tid, name]}
      <option value={tid}>{name}</option>
    {/each}
  </select>
</div>
<div class="control">
  <label for="datestart">From</label>
  <input type="date" id="datestart" bind:value={ds}
    onchange={() => (dateStart = ds || null)}>
  <label for="dateend">To</label>
  <input type="date" id="dateend" bind:value={de}
    onchange={() => (dateEnd = de || null)}>
</div>
