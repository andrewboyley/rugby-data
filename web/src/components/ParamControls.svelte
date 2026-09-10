<script lang="ts">
  import ParamRow from "./ParamRow.svelte";
  import type { FA2Params, FA2ParamKey } from "../graph/layout-optimizer";

  interface Props {
    params: FA2Params;
    locked: Set<FA2ParamKey>;
    autoTune: boolean;
    onChange: (key: FA2ParamKey, value: number | boolean) => void;
    onLockToggle: (key: FA2ParamKey) => void;
    onReset: () => void;
  }

  let { params, locked, autoTune, onChange, onLockToggle, onReset }: Props = $props();

  const paramDefs = [
    // Numeric params (sliders)
    { key: "gravity", label: "Gravity", min: 0.01, max: 10, step: 0.01, type: "slider" as const, title: "Attraction to center; higher = stronger pull to center" },
    { key: "slowDown", label: "SlowDown", min: 0.1, max: 50, step: 0.1, type: "slider" as const, title: "Integration step damping; higher = slower, more stable" },
    { key: "barnesHutTheta", label: "BH Theta", min: 0.1, max: 1, step: 0.05, type: "slider" as const, title: "Barnes-Hut approximation threshold; lower = more accurate, slower" },
    { key: "edgeWeightInfluence", label: "Edge Wt", min: 0, max: 5, step: 0.1, type: "slider" as const, title: "Influence of edge weight on attraction force" },
    // Boolean params (checkboxes)
    { key: "strongGravityMode", label: "Strong Gravity", min: 0, max: 1, step: 1, type: "checkbox" as const, title: "Force all nodes toward center regardless of edges" },
    { key: "barnesHutOptimize", label: "BH Optimize", min: 0, max: 1, step: 1, type: "checkbox" as const, title: "Use Barnes-Hut quadtree approximation for repulsion" },
    { key: "outboundAttractionDistribution", label: "Outbound", min: 0, max: 1, step: 1, type: "checkbox" as const, title: "Distribute attraction force to outbound edges" },
    { key: "linLogMode", label: "LinLog", min: 0, max: 1, step: 1, type: "checkbox" as const, title: "Logarithmic attraction for high-degree nodes" },
  ] as const;

  function fmt(v: number): string {
    return parseFloat(v.toFixed(3)).toString();
  }
</script>

<fieldset class="fieldset border border-base-300 rounded-box p-2">
  <legend class="fieldset-legend text-xs">Parameters</legend>
  <div class="flex flex-col gap-1.5">
    {#each paramDefs as def}
      <ParamRow
        {...def}
        params={params}
        locked={locked}
        autoTune={autoTune}
        onChange={onChange}
        onLockToggle={onLockToggle}
        format={fmt}
      />
    {/each}
  </div>
  <div class="mt-2">
    <button class="btn btn-xs btn-ghost btn-block" onclick={onReset}>Reset</button>
  </div>
</fieldset>
