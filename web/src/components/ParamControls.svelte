<script lang="ts">
  import ParamRow from "./ParamRow.svelte";
  import type { FA2Params, FA2ParamKey } from "../graph/layout-optimizer";

  interface Props {
    params: FA2Params;
    locked: Set<FA2ParamKey>;
    autoTune: boolean;
    bestParams?: FA2Params;
    onChange: (key: FA2ParamKey, value: number | boolean) => void;
    onLockToggle: (key: FA2ParamKey) => void;
  }

  let { params, locked, autoTune, bestParams, onChange, onLockToggle }: Props = $props();

  const paramDefs = [
    // Numeric params (sliders)
    { key: "gravity", label: "Gravity", min: 0.01, max: 10, step: 0.01, type: "slider" as const, title: "Attraction to center; higher = stronger pull to center" },
    { key: "slowDown", label: "SlowDown", min: 0.1, max: 50, step: 0.1, type: "slider" as const, title: "Integration step damping; higher = slower, more stable" },
    { key: "scalingRatio", label: "Scaling", min: 1, max: 100, step: 1, type: "slider" as const, title: "Scaling factor for force magnitude; higher = more spread" },
    { key: "barnesHutTheta", label: "BH Theta", min: 0.1, max: 1, step: 0.05, type: "slider" as const, title: "Barnes-Hut approximation threshold; lower = more accurate, slower" },
    { key: "edgeWeightInfluence", label: "Edge Wt", min: 0, max: 5, step: 0.1, type: "slider" as const, title: "Influence of edge weight on attraction force" },
  ] as const;

  function fmt(v: number): string {
    return parseFloat(v.toFixed(3)).toString();
  }
</script>

<fieldset class="fieldset border border-base-300 rounded-box p-2">
  <legend class="fieldset-legend text-xs flex items-center gap-1">
    Parameters
    <span class="badge badge-xs badge-ghost">🔒 = locked from optimizer</span>
  </legend>
  <div class="flex flex-col gap-1.5">
    {#each paramDefs as def}
      <ParamRow
        {...def}
        params={params}
        locked={locked}
        autoTune={autoTune}
        bestParams={bestParams}
        onChange={onChange}
        onLockToggle={onLockToggle}
        format={fmt}
      />
    {/each}
  </div>
</fieldset>