<script lang="ts">
  import type { House } from '$lib/types';

  export let house: House;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<g
  class="house-marker"
  role="button"
  tabindex="0"
  on:click
  on:keydown
  aria-label={`Haus ${house.name}`}
>
  <circle cx={house.x} cy={house.y} r="15" fill={house.status === 'frei' ? '#22c55e' : '#ef4444'} stroke="white" stroke-width="3" />
  <text x={house.x} y={house.y - 25} text-anchor="middle" class="map-label">{house.name}</text>
</g>

<style>
  .house-marker {
    cursor: pointer;
  }

  .map-label {
    fill: white;
    font-weight: bold;
    font-size: 14px;
    paint-order: stroke;
    stroke: black;
    stroke-width: 3px;
  }
</style>