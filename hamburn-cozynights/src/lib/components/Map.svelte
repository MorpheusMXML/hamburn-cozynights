<script lang="ts">
  import UserHouseMarker from './UserHouseMarker.svelte';
  import { createEventDispatcher, onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  
  export let houses: any[] = [];
  export let isEditorMode = false;
  export let isBookingActive = false;

  const dispatch = createEventDispatcher();

  // Mouse Glow State
  let mouseX = 0;
  let mouseY = 0;
  let svgEl: SVGSVGElement;

  function handleMouseMoveGlobal(event: MouseEvent) {
      if (!svgEl) return;
      const CTM = svgEl.getScreenCTM();
      if (!CTM) return;
      mouseX = (event.clientX - CTM.e) / CTM.a;
      mouseY = (event.clientY - CTM.f) / CTM.d;
  }

  // Drag & Drop State
  let draggingHouseId: string | null = null;
  let dragOffset = { x: 0, y: 0 };
  let hasDragged = false;

  // Context Menu State
  let selectedHouseId: string | null = null;

  function handleMouseDown(event: MouseEvent, house: any) {
    if (!isEditorMode || isBookingActive) return;
    
    draggingHouseId = house.id;
    hasDragged = false;
    
    const svg = (event.currentTarget as SVGElement).closest('svg');
    if (!svg) return;
    
    const CTM = svg.getScreenCTM();
    if (!CTM) return;
    
    // Get mouse position relative to SVG coordinates
    const mX = (event.clientX - CTM.e) / CTM.a;
    const mY = (event.clientY - CTM.f) / CTM.d;
    
    dragOffset = {
      x: mX - house.x,
      y: mY - house.y
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleMouseMove(event: MouseEvent) {
    if (!draggingHouseId) return;
    hasDragged = true;
    
    if (!svgEl) return;
    const CTM = svgEl.getScreenCTM();
    if (!CTM) return;
    
    const mX = (event.clientX - CTM.e) / CTM.a;
    const mY = (event.clientY - CTM.f) / CTM.d;
    
    const newX = Math.round(mX - dragOffset.x);
    const newY = Math.round(mY - dragOffset.y);
    
    // Local update for immediate feedback
    const index = houses.findIndex(h => h.id === draggingHouseId);
    if (index !== -1) {
      houses[index].x = newX;
      houses[index].y = newY;
      houses = [...houses];
    }
  }

  function handleMouseUp() {
    if (draggingHouseId) {
      const house = houses.find(h => h.id === draggingHouseId);
      if (house && hasDragged) {
        dispatch('houseMoved', { id: house.id, x: house.x, y: house.y });
      }
      draggingHouseId = null;
    }
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }

  function handleHouseClick(event: MouseEvent, house: any) {
    if (isEditorMode) {
      // ALWAYS stop propagation in editor mode to avoid triggering "new house" logic on the SVG
      event.preventDefault();
      event.stopPropagation();

      if (hasDragged) return; // Prevent menu opening if we just finished a drag
      
      if (selectedHouseId === house.id) {
        selectedHouseId = null;
      } else {
        selectedHouseId = house.id;
        // In the new sidebar architecture, we use renameHouse event to trigger selection
        dispatch('renameHouse', house); 
      }
      return;
    }

    // Client-side navigation or Staging Mode warning
    if (!isBookingActive) {
        event.preventDefault();
        event.stopPropagation();
        alert("PATIENCE, BURNER! 🏜️ This house is currently being calibrated in Staging Mode. Ignition starts when the timer hits zero.");
    }
  }

  function handleMapClick(event: MouseEvent) {
    if (selectedHouseId) {
      selectedHouseId = null;
      return;
    }
    
    if (!isEditorMode) return;
    
    if (!svgEl) return;
    const CTM = svgEl.getScreenCTM();
    if (!CTM) return;
    
    const x = Math.round((event.clientX - CTM.e) / CTM.a);
    const y = Math.round((event.clientY - CTM.f) / CTM.d);
    
    dispatch('locationSelected', { x, y });
  }
</script>

<div class="map-wrapper" on:mousemove={handleMouseMoveGlobal} role="presentation">
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <svg 
    viewBox="0 0 1000 700" 
    preserveAspectRatio="xMidYMid meet"
    on:click={handleMapClick}
    bind:this={svgEl}
  >
    <defs>
        <radialGradient id="mouseGlow" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <stop offset="0%" stop-color="rgba(45, 212, 191, 0.2)" />
            <stop offset="100%" stop-color="rgba(45, 212, 191, 0)" />
        </radialGradient>
        <filter id="laserBlur">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" />
        </filter>
    </defs>

    <image href="/lageplan-brahmsee.jpg" width="1000" height="700" class="map-image" class:blurred={!isBookingActive && !isEditorMode} />
    
    <!-- Dynamic Mouse Glow -->
    <circle cx={mouseX} cy={mouseY} r="150" fill="url(#mouseGlow)" pointer-events="none" opacity={isEditorMode ? 1 : 0.5} />

    {#if houses && houses.length > 0}
      <g class="marker-layer">
        {#each houses as house (house.id)}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <g 
            class="house-group" 
            class:dragging={draggingHouseId === house.id}
            class:selected={selectedHouseId === house.id}
            class:lock-drag={isBookingActive}
            on:mousedown={(e) => handleMouseDown(e, house)}
            on:click={(e) => handleHouseClick(e, house)}
          >
            <foreignObject 
              x={house.x} 
              y={house.y} 
              width="1" 
              height="1" 
              style="overflow: visible;"
            >
              {#if !isEditorMode}
                <a href="/house/{house.id}" class="marker-link">
                  <UserHouseMarker 
                    name={house.name} 
                    status={house.occupiedBeds >= house.totalBeds ? 'full' : 'available'} 
                  />
                </a>
              {:else}
                <div class="admin-marker-wrapper">
                  <UserHouseMarker 
                    name={house.name} 
                    status={house.occupiedBeds >= house.totalBeds ? 'full' : 'available'} 
                  />
                </div>
              {/if}
            </foreignObject>
          </g>
        {/each}
      </g>
    {/if}
  </svg>
</div>

<style>
  .map-wrapper {
    width: 100%;
    height: 100%;
    background: #000;
    position: relative;
    cursor: crosshair;
  }
  svg {
    width: 100%;
    height: 100%;
    display: block;
  }
  
  .map-image {
      transition: filter 1s ease;
  }
  .map-image.blurred {
      filter: blur(5px) grayscale(0.5) brightness(0.3);
  }

  .marker-link {
    text-decoration: none;
    cursor: pointer;
    pointer-events: auto;
  }
  
  .house-group {
    cursor: grab;
    pointer-events: auto;
  }
  .house-group.dragging { cursor: grabbing; }
  .house-group.lock-drag { cursor: pointer; }
  .house-group.selected { filter: drop-shadow(0 0 15px #f472b6); }
  
  .admin-marker-wrapper {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  /* Kleiner Animationstrick: Marker faden sanft ein, wenn sie geladen werden */
  .marker-layer {
    animation: fadeIn 0.3s ease-out forwards;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>