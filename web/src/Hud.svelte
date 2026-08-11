<script>
  import { teamName } from "./lib.js";

  let { node, deg, partners, teams, onClear } = $props();

  function partnerName(l) {
    return l.source.id === node.id ? l.target.name : l.source.name;
  }
  function linkKey(l) {
    return `${l.source.id}-${l.target.id}`;
  }
</script>

{#if node}
  <div id="hud">
    <div class="name">{node.name}</div>
    <div class="row">{teamName(teams, node.team)}</div>
    <div class="row">{node.app} appearances &middot; {deg} teammates</div>
    <div class="row">showing {partners.length} links</div>
    <div class="links">
      {#each partners as l (linkKey(l))}
        <div>{partnerName(l)} &mdash; {l.w}</div>
      {/each}
    </div>
    <button class="btn clear" onclick={onClear}>clear</button>
  </div>
{/if}
