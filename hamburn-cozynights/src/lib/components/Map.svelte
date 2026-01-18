<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { HousesResponse } from '$lib/pocketbase-types';
  
  // WICHTIG: Wir importieren den neuen User-Marker
  import UserHouseMarker from './UserHouseMarker.svelte';
  import HouseEditor from './HouseEditor.svelte';

  export let houses: HousesResponse[] = [];
  export let isEditorMode = false;

  const dispatch = createEventDispatcher();
  let pendingCoords: { x: number, y: number } | null = null;

  function handleMapClick(event: MouseEvent) {
    if (!isEditorMode) return;

    const svg = event.currentTarget as SVGSVGElement;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    
    const screenCTM = svg.getScreenCTM();
    
    if (screenCTM) {
      const cursorPt = pt.matrixTransform(screenCTM.inverse());
      // Runden für saubere Integer-Werte in der DB
      const x = Math.round(cursorPt.x);
      const y = Math.round(cursorPt.y);
      
      pendingCoords = { x, y };
    }
  }

  function handleSave(event: CustomEvent) {
    if (pendingCoords) {
        // Event mit Koordinaten anreichern und weiterleiten
        dispatch('save', { ...event.detail, x: pendingCoords.x, y: pendingCoords.y });
        pendingCoords = null;
    }
  }
</script>

<div class="map-wrapper">
  <svg 
    viewBox="0 0 1000 700" 
    on:click={handleMapClick} 
    role="presentation" 
    class:cursor-crosshair={isEditorMode}
  >
    <image href="/lageplan-brahmsee.jpg" width="1000" height="700" />
    
    {#each houses as house (house.id)}
      <foreignObject 
        x={house.x} 
        y={house.y} 
        width="1" 
        height="1" 
        style="overflow: visible;"
      >
        <div class="marker-wrapper">
            {#if isEditorMode}
                <div class="disabled-link">
                    <UserHouseMarker 
                      name={house.name} 
                      status={house.occupied ? 'voll' : 'frei'} 
                    />
                </div>
            {:else}
                <a href="/house/{house.id}" class="marker-link">
                    <UserHouseMarker 
                      name={house.name} 
                      status={house.occupied ? 'voll' : 'frei'} 
                    />
                </a>
            {/if}
        </div>
      </foreignObject>
    {/each}

    {#if pendingCoords}
      <foreignObject x={pendingCoords.x} y={pendingCoords.y} width="1" height="1" style="overflow: visible;">
        <div class="marker-wrapper">
            <HouseEditor 
                x={pendingCoords.x}
                y={pendingCoords.y}
                on:save={handleSave}
                on:cancel={() => pendingCoords = null}
            />
        </div>
      </foreignObject>
    {/if}
  </svg>
</div>

<style>
  .map-wrapper {
    position: relative;
    width: 100vw; 
    height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    background: #050505; 
    overflow: hidden;
  }

  svg {
    width: 100%;
    height: 100%;
    max-width: 100vw;
    max-height: 100vh;
    display: block;
    object-fit: contain; 
  }

  .cursor-crosshair { cursor: crosshair; }

  /* Zentriert den Inhalt exakt auf dem Punkt */
  .marker-wrapper {
    position: absolute;
    top: 0; 
    left: 0;
    /* Kein Display Flex nötig, UserHouseMarker kümmert sich um Zentrierung via transform */
  }

  .marker-link {
    text-decoration: none;
    display: block;
    transition: transform 0.2s;
    cursor: pointer;
  }

  .marker-link:hover {
    transform: scale(1.15);
    z-index: 100; /* Holt den hoverten Marker nach vorne */
  }

  .disabled-link {
    opacity: 0.6;
    pointer-events: none;
  }
</style>