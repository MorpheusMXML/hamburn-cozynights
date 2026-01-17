<script lang="ts">
  import type { House } from '$lib/types';

  export let house: House;

  // Die Funktion, die das Event verarbeitet
  function handleClick(event: MouseEvent) {
    // clientX/Y sind relativ zum Browser-Fenster
    // offsetX/Y sind relativ zum SVG-Element (oft hilfreicher)
    const { offsetX, offsetY } = event;
    
    console.log(`Klick auf Haus: ${house.name}`);
    console.log(`X-Koordinate: ${offsetX}, Y-Koordinate: ${offsetY}`);
  }
</script>

<g
  class="house-marker"
  role="button"
  tabindex="0"
  on:click={handleClick} 
  on:keydown
  aria-label={`Haus ${house.name}`}
>
  <circle 
    cx={house.x} 
    cy={house.y} 
    r="15" 
    fill={house.status === 'frei' ? '#22c55e' : '#ef4444'} 
    stroke="white" 
    stroke-width="3" 
  />
  <text x={house.x} y={house.y - 25} text-anchor="middle" class="map-label">
    {house.name}
  </text>
</g>