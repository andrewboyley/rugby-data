<script lang="ts">
  import type { FA2Params, FA2ParamKey } from "../graph/layout-optimizer";

  interface Props {
    key: FA2ParamKey;
    label: string;
    min: number;
    max: number;
    step: number;
    type: "slider" | "checkbox";
    params: FA2Params;
    locked: Set<FA2ParamKey>;
    autoTune: boolean;
    onChange: (key: FA2ParamKey, value: number | boolean) => void;
    onLockToggle: (key: FA2ParamKey) => void;
    title: string;
    format?: (v: number) => string;
  }

  let { key, label, min, max, step, type, params, locked, autoTune, onChange, onLockToggle, title, format = (v: number) => parseFloat(v.toFixed(3)).toString() }: Props = $props();

  const isLocked = $derived(locked.has(key));
  const disabled = $derived(autoTune && !isLocked);
  const displayValue = $derived(params[key]);

  function handleSliderInput(e: Event) {
    if (!autoTune || isLocked) {
      const target = e.currentTarget as HTMLInputElement;
      onChange(key, +target.value);
    }
  }

  function handleCheckboxChange(e: Event) {
    if (!autoTune || isLocked) {
      const target = e.currentTarget as HTMLInputElement;
      onChange(key, target.checked);
    }
  }
</script>

<div class="flex items-center gap-2 text-xs font-mono cursor-pointer">
  <label class="flex items-center gap-2 flex-1 cursor-pointer" title={title}>
    {#if type === "slider"}
      <span class="w-16">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={displayValue}
        class="range range-xs flex-1"
        disabled={disabled}
        oninput={handleSliderInput}
      />
      <span class="w-10 text-right">{format(displayValue as number)}</span>
    {:else}
      <input
        type="checkbox"
        checked={displayValue as boolean}
        class="checkbox checkbox-xs"
        disabled={disabled}
        onchange={handleCheckboxChange}
      />
      {label}
    {/if}
  </label>
  <button
    type="button"
    class="btn btn-xs btn-ghost px-1 min-h-0 h-5 {isLocked ? 'text-warning' : 'text-base-content/30'}"
    onclick={() => onLockToggle(key)}
    title="Lock from optimizer"
  >{isLocked ? '🔒' : '🔓'}</button>
</div>
