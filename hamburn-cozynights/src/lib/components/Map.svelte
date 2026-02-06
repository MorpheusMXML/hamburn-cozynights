<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import UserHouseMarker from './UserHouseMarker.svelte';

  export let houses: any[] = [];
  export let isEditorMode = false;

  const dispatch = createEventDispatcher();

  function handleMapClick(event: MouseEvent) {
    if (!isEditorMode) return;

    const svg = event.currentTarget as SVGSVGElement;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    
    const screenCTM = svg.getScreenCTM();
    if (screenCTM) {
      const cursorPt = pt.matrixTransform(screenCTM.inverse());
      // Wir senden nur die Koordinaten, das Formular öffnet der Admin
      dispatch('locationSelected', { 
        x: Math.round(cursorPt.x), 
        y: Math.round(cursorPt.y) 
      });
    }
  }
</script>

<div class="map-container">
  <svg 
    viewBox="0 0 1000 700" 
    preserveAspectRatio="xMidYMid meet"
    on:click={handleMapClick}
    class:editor-active={isEditorMode}
  >
    <image href="/lageplan-brahmsee.jpg" width="1000" height="700" />
    
    {#each houses as house (house.id)}
      <foreignObject x={house.x} y={house.y} width="1" height="1" style="overflow: visible;">
        <UserHouseMarker 
          name={house.name} 
          status={house.occupiedBeds >= house.totalBeds ? 'full' : 'available'} 
        />
      </foreignObject>
    {/each}
  </svg>
</div>

<style>
  .map-container {
    width: 100%;
    max-height: 70vh;
    background: #111;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #333;
    display: flex;
    justify-content: center;
  }
  svg { width: 100%; height: auto; display: block; }
  .editor-active { cursor: crosshair; }
</style>